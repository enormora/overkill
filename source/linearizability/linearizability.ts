import { z } from 'zod';
import { defineCompositeAssertion } from '../packages/assert/assert.entry-point.ts';
import { captureSourceLocation, forwardAssertionSourceLocations } from '../packages/engine/engine.entry-point.ts';
import type { PropertyBody, PropertySampleScope } from '../packages/property/property.entry-point.ts';
import { checkLinearizability } from './check-linearizability.ts';
import { concurrentHistory } from './concurrent-history.ts';
import type {
    LinearizabilityDefinition,
    LinearizabilityProgram,
    LinearizabilityResult
} from './linearizability-definition.ts';

type HistoryEvidence = { readonly history: readonly unknown[]; readonly result: LinearizabilityResult; };
const consistentHistory = defineCompositeAssertion({
    name: 'linearizability',
    assert(check, evidence: HistoryEvidence) {
        return check.equal(evidence.result.kind, 'linearizable');
    },
    formatSummary(_context, evidence: HistoryEvidence) {
        return `Linearizability check of ${evidence.history.length} recorded events: ${evidence.result.kind}.`;
    }
});
const callable = z.custom(function (value) {
    return typeof value === 'function';
});
const definitionSchema = z.object({
    create: callable,
    run: callable,
    model: z.object({ initial: callable, transition: callable }),
    maxWork: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
});
const denseArray = z.custom<unknown[]>(function (value) {
    if (!Array.isArray(value)) {
        return false;
    }
    return Array
        .from({ length: value.length }, function (_entry, index) {
            return Object.hasOwn(value, index);
        })
        .every(Boolean);
});
const programSchema = denseArray.pipe(z.array(denseArray));

function reconstructProgram<Operation>(
    sample: PropertySampleScope<LinearizabilityProgram<Operation>>
): LinearizabilityProgram<Operation> {
    const program = sample.reconstructInput();
    if (!programSchema.safeParse(program).success) {
        throw new TypeError('Linearizability input requires dense arrays of operation lanes.');
    }
    return Object.freeze(program.map(function (lane) {
        return Object.freeze(Array.from(lane));
    }));
}

async function evaluateProgram<State, Operation, Output, System>(
    definition: LinearizabilityDefinition<State, Operation, Output, System>,
    sample: PropertySampleScope<LinearizabilityProgram<Operation>>
): Promise<HistoryEvidence> {
    sample.signal.throwIfAborted();
    const execution = reconstructProgram(sample);
    const prediction = reconstructProgram(sample);
    if (
        execution.length !== prediction.length ||
        execution.some(function (lane, index) {
            return lane.length !== prediction[index]?.length;
        })
    ) {
        throw new TypeError('Linearizability reconstruction changed lane lengths.');
    }
    const system = await definition.create(sample);
    sample.signal.throwIfAborted();
    const history = await concurrentHistory(definition.run, system, [ execution, prediction ], sample.signal);
    const result = await checkLinearizability({
        history,
        model: definition.model,
        maxWork: definition.maxWork,
        signal: sample.signal
    });
    return { history, result };
}

export function linearizability<State, Operation, Output, System>(
    definition: LinearizabilityDefinition<State, Operation, Output, System>
): PropertyBody<LinearizabilityProgram<Operation>> {
    if (!definitionSchema.safeParse(definition).success) {
        throw new TypeError('linearizability() requires create, run, model, and a positive safe-integer maxWork.');
    }
    const snapshot = Object.freeze({ ...definition, model: Object.freeze({ ...definition.model }) });
    const location = captureSourceLocation();
    return async function executeProgram(_program, sample) {
        const evidence = await evaluateProgram(snapshot, sample);
        if (evidence.result.kind === 'inconclusive') {
            sample.inconclusive(
                `Linearizability search exhausted ${evidence.result.work} work units (${evidence.result.reason}).`
            );
        }
        forwardAssertionSourceLocations([ location ], function () {
            sample.assert(consistentHistory, evidence);
        });
        return sample.assert.collect();
    };
}

import type { BaselineComparison, BaselineUpdateMode } from '../baselines/baseline-model.ts';
import type { BaselineDiagnostic } from '../baselines/performance-adapter.ts';
import type {
    BaselineAdapterDefinition,
    BaselineEvaluationInput,
    BaselinePayload,
    OrdinaryBaselineAdapter,
    OrdinaryBaselineEvaluation
} from '../baselines/ordinary-baseline-adapter.ts';

type BaselineExpectation<Value> = { readonly kind: 'existing'; readonly value: Value; } | { readonly kind: 'missing'; };

async function compareObservation<Observed, Value, Proposal>(
    definition: BaselineAdapterDefinition<Observed, Value, Proposal>,
    mode: BaselineUpdateMode,
    actual: Value,
    expected: BaselineExpectation<Value>
): Promise<BaselineComparison<BaselineDiagnostic> | null> {
    if (expected.kind === 'missing' || mode !== 'none' && mode !== 'bootstrap') {
        return null;
    }
    return await definition.adapter.compare({ actual, expected: expected.value });
}

async function proposeObservation<Observed, Value, Proposal>(
    definition: BaselineAdapterDefinition<Observed, Value, Proposal>,
    input: BaselineEvaluationInput,
    actual: Value,
    expected: Value | null
): Promise<BaselinePayload | null> {
    if (input.mode === 'none' || input.mode === 'bootstrap' && input.existing !== null) {
        return null;
    }
    return await definition.encode(await definition.adapter.propose({ actual, expected }));
}

async function decodeExpectation<Value>(
    payload: BaselinePayload | null,
    decode: (payload: BaselinePayload) => Promise<Value> | Value
): Promise<BaselineExpectation<Value>> {
    return payload === null ? { kind: 'missing' } : { kind: 'existing', value: await decode(payload) };
}

export function defineBaselineAdapter<Observed, Value, Proposal>(
    definition: BaselineAdapterDefinition<Observed, Value, Proposal>
): OrdinaryBaselineAdapter {
    const { adapter } = definition;
    if (adapter.id.trim().length === 0) {
        throw new TypeError('Baseline adapter ID must not be empty.');
    }
    return Object.freeze({
        id: adapter.id.normalize('NFC'),
        subtype: definition.subtype,
        comparisonContext: Object.freeze({ ...definition.comparisonContext }),
        async evaluate(input: BaselineEvaluationInput): Promise<OrdinaryBaselineEvaluation> {
            const observation = await adapter.observe({ artifacts: input.artifacts, work: input.work });
            if (observation.kind !== 'observed') {
                return observation;
            }
            const actual = await definition.toComparisonValue(observation.value);
            const stored = await decodeExpectation(input.existing, definition.decode);
            const expected = stored.kind === 'existing' ? stored.value : null;
            return {
                kind: 'observed',
                comparison: await compareObservation(definition, input.mode, actual, stored),
                proposal: await proposeObservation(definition, input, actual, expected)
            };
        }
    });
}

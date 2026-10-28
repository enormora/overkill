import type { PropertyExecutionHost, PropertyTrialResult } from '../packages/engine/engine.entry-point.ts';
import { enumerateDomain } from './generator-enumeration.ts';
import {
    createCoverage,
    coverageRequirements,
    type PropertyCoverage,
    type CoverageSnapshot,
    type CoverageTrial
} from './property-coverage.ts';
import { generateInput } from './generator-input.ts';
import { readGeneratorEdges } from './generator.ts';
import type { InputRecipe } from './generator-edges.ts';
import type { NormalizedPropertyInvocation } from './property-definition.ts';
import { propertyRandom } from './property-random.ts';
import {
    createPropertyWork,
    propertyExhaustion,
    type PropertyAccounting,
    type PropertyPhase,
    type PropertyWork
} from './property-work.ts';

export type PropertyRegressionInputs<Value> = {
    readonly checkedIn: Iterable<InputRecipe<Value>>;
    readonly localCache: Iterable<InputRecipe<Value>>;
};

export type PropertyExecutionResult<Value> = {
    readonly kind: 'completed' | 'coverage-unmet' | 'generation-exhausted' | 'work-exhausted';
    readonly accounting: PropertyAccounting;
    readonly exhaustive: number | null;
    readonly coverage: CoverageSnapshot;
} | {
    readonly kind: 'failed';
    readonly exhaustive: number | null;
    readonly coverage: CoverageSnapshot;
    readonly accounting: PropertyAccounting;
    readonly trial: Exclude<PropertyTrialResult, { readonly kind: 'passed'; }>;
    readonly input: InputRecipe<Value>;
};

export type PropertyInvocationContext = {
    readonly host: PropertyExecutionHost;
    readonly signal: AbortSignal;
    readonly identity: string;
};

type PropertyExecution<Value> = PropertyInvocationContext & {
    readonly invocation: NormalizedPropertyInvocation<Value>;
    readonly work: PropertyWork;
    readonly coverage: PropertyCoverage;
    readonly phase: PropertyPhase;
    readonly exhaustive: number | null;
};

type TrialPhase<Value> = {
    readonly name: PropertyPhase;
    readonly inputs: Iterable<InputRecipe<Value>>;
    readonly limit: number;
};

function unavailableObservation(): never {
    throw new TypeError('Property targeting is not available yet.');
}

function trialResult<Value>(
    execution: PropertyExecution<Value>,
    input: InputRecipe<Value>,
    trial: PropertyTrialResult
): PropertyExecutionResult<Value> | null {
    return trial.kind === 'passed'
        ? null
        : {
            kind: 'failed',
            accounting: execution.work.snapshot(),
            trial,
            input,
            coverage: execution.coverage.snapshot(),
            exhaustive: execution.exhaustive
        };
}

async function evaluateObservedInput<Value>(
    execution: PropertyExecution<Value>,
    input: InputRecipe<Value>,
    value: Value,
    observations: CoverageTrial
): Promise<PropertyExecutionResult<Value> | null> {
    let passed = false;
    try {
        const trial = await execution.host.evaluateTrial(async function runPropertySample(scope) {
            execution.work.execute();
            return await execution.invocation.test(value, {
                ...scope,
                target: unavailableObservation,
                cover: observations.cover
            });
        }, execution.signal);
        passed = trial.kind === 'passed';
        return trialResult(execution, input, trial);
    } finally {
        observations.finish(passed);
    }
}

async function evaluateInput<Value>(
    execution: PropertyExecution<Value>,
    input: InputRecipe<Value>
): Promise<PropertyExecutionResult<Value> | null> {
    const { signal, work } = execution;
    signal.throwIfAborted();
    work.context.consumeWork();
    const value = input();
    work.context.consumeWork();
    const observations = execution.coverage.trial(execution.phase);
    return await evaluateObservedInput(execution, input, value, observations);
}

function boundedInputs<Value>(
    execution: PropertyExecution<Value>,
    phase: TrialPhase<Value>
): IteratorObject<InputRecipe<Value>> {
    const iterator = phase.inputs[Symbol.iterator]();
    return Iterator
        .from({
            next() {
                execution.signal.throwIfAborted();
                execution.work.context.consumeWork();
                return iterator.next();
            },
            return() {
                return iterator.return === undefined ? { done: true, value: undefined } : iterator.return();
            }
        })
        .take(phase.limit);
}

async function executePhase<Value>(
    execution: PropertyExecution<Value>,
    phase: TrialPhase<Value>
): Promise<PropertyExecutionResult<Value> | null> {
    execution.work.enterPhase(phase.name);

    const inputs = boundedInputs(execution, phase);
    for (const input of inputs) {
        const result = await evaluateInput({ ...execution, phase: phase.name }, input);
        if (result !== null) {
            return result;
        }
    }
    return null;
}

function* explorationInputs<Value>(execution: PropertyExecution<Value>): Generator<InputRecipe<Value>> {
    const random = propertyRandom(execution.host, execution.identity);
    for (let index = 0; index < execution.host.policy.newTrials; index += 1) {
        const input = generateInput(execution.invocation.generator, random, undefined, execution.work.context);
        yield input.reconstruct;
    }
}

function trialPhases<Value>(
    execution: PropertyExecution<Value>,
    regressions: PropertyRegressionInputs<Value>
): readonly TrialPhase<Value>[] {
    const { invocation, host, work } = execution;
    const required = Number.MAX_SAFE_INTEGER;
    return [
        { name: 'checked-in-corpus', inputs: regressions.checkedIn, limit: required },
        { name: 'local-cache', inputs: regressions.localCache, limit: required },
        { name: 'examples', inputs: invocation.examples, limit: required },
        {
            name: 'automatic-edges',
            inputs: readGeneratorEdges(invocation.generator)(work.context),
            limit: host.policy.maxAutomaticEdges
        }
    ];
}

function completedExecution<Value>(
    execution: PropertyExecution<Value>,
    exhaustive: number | null
): PropertyExecutionResult<Value> {
    return {
        kind: execution.coverage.unmet().length === 0 ? 'completed' : 'coverage-unmet',
        accounting: execution.work.snapshot(),
        coverage: execution.coverage.snapshot(),
        exhaustive
    };
}

async function executeExploration<Value>(execution: PropertyExecution<Value>): Promise<PropertyExecutionResult<Value>> {
    execution.work.enterPhase('exploration');
    const domain = enumerateDomain(
        execution.invocation.generator,
        {
            ...execution.work.context,
            consumeWork() {
                execution.signal.throwIfAborted();
                execution.work.context.consumeWork();
            }
        },
        execution.host.policy.maxExhaustiveValues
    );
    const exhaustive = domain === null ? null : domain.length;
    if (domain?.length === 0) {
        execution.work.context.exhaustDomain();
    }
    const failed = await executePhase(
        { ...execution, exhaustive },
        domain === null
            ? { name: 'exploration', inputs: explorationInputs(execution), limit: execution.host.policy.newTrials }
            : { name: 'exhaustive', inputs: domain, limit: domain.length }
    );
    if (failed !== null) {
        return failed;
    }
    return completedExecution(execution, exhaustive);
}

async function executePhases<Value>(
    execution: PropertyExecution<Value>,
    regressions: PropertyRegressionInputs<Value>
): Promise<PropertyExecutionResult<Value>> {
    const phases = trialPhases(execution, regressions);
    for (const phase of phases) {
        const failed = await executePhase(execution, phase);
        if (failed !== null) {
            return failed;
        }
    }
    return await executeExploration(execution);
}

export async function executeProperty<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    regressions: PropertyRegressionInputs<Value>,
    context: PropertyInvocationContext
): Promise<PropertyExecutionResult<Value>> {
    const work = createPropertyWork(context.host.policy);
    const coverage = createCoverage(
        coverageRequirements(Object.hasOwn(invocation, 'coverage') ? Reflect.get(invocation, 'coverage') : []),
        context.host.policy.maxLabels
    );
    const execution: PropertyExecution<Value> = {
        ...context,
        invocation,
        work,
        coverage,
        phase: 'checked-in-corpus',
        exhaustive: null
    };
    try {
        return await executePhases(execution, regressions);
    } catch (error: unknown) {
        const exhaustion = propertyExhaustion(error);
        if (exhaustion === null) {
            throw error;
        }
        return {
            kind: exhaustion,
            accounting: work.snapshot(),
            coverage: coverage.snapshot(),
            exhaustive: execution.exhaustive
        };
    }
}

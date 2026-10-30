import { observePropertyTrial, type ObservedTrial } from './property-trial-observation.ts';
import { enumerateDomain } from './generator-enumeration.ts';
import type { PropertyCoverage } from './property-coverage.ts';
import { invocationSearch, type PropertySearch } from './property-search.ts';
import { readGeneratorEdges } from './generator.ts';
import type { InputRecipe } from './generator-edges.ts';
import type { NormalizedPropertyInvocation } from './property-definition.ts';
import type { PropertyPhase, PropertyWork } from './property-work.ts';
import type {
    PropertyExecutionResult,
    PropertyRegressionInputs,
    PropertyInvocationContext
} from './property-execution-result.ts';

export type PropertyExecution<Value> = PropertyInvocationContext & {
    readonly invocation: NormalizedPropertyInvocation<Value>;
    readonly work: PropertyWork;
    readonly coverage: PropertyCoverage;
    readonly observeLabel: (label: string) => void;
    readonly observeScores: (scores: ReadonlyMap<string, number>) => void;
    readonly phase: PropertyPhase;
    readonly exhaustive: number | null;
};

type TrialPhase<Value> = {
    readonly name: PropertyPhase;
    readonly inputs: Iterable<InputRecipe<Value>>;
    readonly limit: number;
};

function trialResult<Value>(
    execution: PropertyExecution<Value>,
    input: InputRecipe<Value>,
    observed: ObservedTrial
): PropertyExecutionResult<Value> | null {
    const { trial, key: failureKey, observation } = observed;
    return trial.kind === 'passed'
        ? null
        : {
            kind: 'failed',
            accounting: execution.work.snapshot(),
            trial,
            input,
            generated: null,
            failureKey,
            observation,
            coverage: execution.coverage.snapshot(),
            exhaustive: execution.exhaustive
        };
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
    const observed = await observePropertyTrial(value, execution.invocation, {
        ...execution,
        observations
    });
    return trialResult(execution, input, observed);
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

async function evaluateExploration<Value>(
    execution: PropertyExecution<Value>,
    search: PropertySearch<Value>,
    last: boolean
): Promise<PropertyExecutionResult<Value> | null> {
    execution.signal.throwIfAborted();
    const candidate = search.next();
    let scores: ReadonlyMap<string, number> = new Map();
    const failed = await evaluateInput({
        ...execution,
        phase: 'exploration',
        observeScores(value) {
            scores = value;
        }
    }, candidate.input.reconstruct);
    if (failed === null && !last) {
        search.accept(candidate, scores);
    }
    return failed?.kind === 'failed' ? { ...failed, generated: candidate.input } : failed;
}

async function exploreInputs<Value>(execution: PropertyExecution<Value>): Promise<PropertyExecutionResult<Value>> {
    const search = invocationSearch(execution.invocation.generator, execution.host, execution.identity, {
        ...execution.work.context,
        consumeWork() {
            execution.signal.throwIfAborted();
            execution.work.context.consumeWork();
        }
    });
    for (let index = 0; index < execution.host.policy.newTrials; index += 1) {
        const failed = await evaluateExploration(execution, search, index + 1 === execution.host.policy.newTrials);
        if (failed !== null) {
            return failed;
        }
    }
    return completedExecution(execution, null);
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
    if (domain?.length === 0) {
        execution.work.context.exhaustDomain();
    }
    if (domain === null) {
        return await exploreInputs(execution);
    }
    const failed = await executePhase(
        { ...execution, exhaustive: domain.length },
        { name: 'exhaustive', inputs: domain, limit: domain.length }
    );
    if (failed !== null) {
        return failed;
    }
    return completedExecution(execution, domain.length);
}

export async function executePhases<Value>(
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

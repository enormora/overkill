import type { PropertyExecutionHost, PropertyTrialResult } from '../packages/engine/engine.entry-point.ts';
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
    readonly kind: 'completed' | 'generation-exhausted' | 'work-exhausted';
    readonly accounting: PropertyAccounting;
} | {
    readonly kind: 'failed';
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
};

type TrialPhase<Value> = {
    readonly name: PropertyPhase;
    readonly inputs: Iterable<InputRecipe<Value>>;
    readonly limit: number;
};

function unavailableObservation(): never {
    throw new TypeError('Property targeting and input coverage are not available yet.');
}

async function evaluateInput<Value>(
    execution: PropertyExecution<Value>,
    input: InputRecipe<Value>
): Promise<PropertyExecutionResult<Value> | null> {
    const { host, invocation, signal, work } = execution;
    signal.throwIfAborted();
    work.context.consumeWork();
    const value = input();
    work.context.consumeWork();
    const trial = await host.evaluateTrial(async function runPropertySample(scope) {
        work.execute();
        return await invocation.test(value, {
            ...scope,
            target: unavailableObservation,
            cover: unavailableObservation
        });
    }, signal);
    return trial.kind === 'passed' ? null : { kind: 'failed', accounting: work.snapshot(), trial, input };
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
        const result = await evaluateInput(execution, input);
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
        },
        { name: 'exploration', inputs: explorationInputs(execution), limit: host.policy.newTrials }
    ];
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
    return { kind: 'completed', accounting: execution.work.snapshot() };
}

export async function executeProperty<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    regressions: PropertyRegressionInputs<Value>,
    context: PropertyInvocationContext
): Promise<PropertyExecutionResult<Value>> {
    const work = createPropertyWork(context.host.policy);
    try {
        return await executePhases({ ...context, invocation, work }, regressions);
    } catch (error: unknown) {
        const exhaustion = propertyExhaustion(error);
        if (exhaustion === null) {
            throw error;
        }
        return { kind: exhaustion, accounting: work.snapshot() };
    }
}

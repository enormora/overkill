import {
    CaseRunnerError,
    stopPropertyExecution,
    type AssertionResult,
    type AssertAssertionNode,
    type DefinitionLocations
} from '../packages/engine/engine.entry-point.ts';
import type { PropertyWitnessFile } from '../engine/witness-file.ts';
import type { PropertyWork } from './property-work.ts';
import type { PropertyExecution } from './property-trial-phases.ts';
import type { NormalizedPropertyInvocation } from './property-definition.ts';
import type { PropertyInvocationContext } from './property-execution-result.ts';
import { propertyRegressionInputs } from './property-regressions.ts';
import { createPropertyExecution } from './property-execution.ts';
import { observePropertyTrial, type ObservedTrial } from './property-trial-observation.ts';

type ReplayContext = PropertyInvocationContext & { readonly locations: DefinitionLocations; };

export function propertyReplayError(message: string, cause: unknown): CaseRunnerError {
    return new CaseRunnerError(message, { subtype: 'witness-replay', cause });
}

async function recordReplayResult<Value>(execution: PropertyExecution<Value>, observed: ObservedTrial): Promise<void> {
    const observations = observed.trial.kind === 'passed'
        ? { original: null, retained: null }
        : { original: observed.observation, retained: observed.observation };
    await execution.host.recordEvidence({
        summary: null,
        identity: execution.identity,
        confirmedWitness: null,
        shrinkStatus: null,
        ...observations,
        diagnostics: []
    });
    const failure = observed.trial.kind === 'terminated' ? 'interrupted' : 'failed';
    await execution.publish(observed.trial.kind === 'passed' ? 'completed' : failure, null);
}

function replayInput<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    context: ReplayContext,
    work: PropertyWork
): () => Value {
    const inputs = propertyRegressionInputs(invocation, context, work.context, function () {
        return undefined;
    });
    const first = inputs.checkedIn[Symbol.iterator]().next();
    if (first.done === true) {
        throw propertyReplayError('Witness does not match the executing property.', null);
    }
    return first.value;
}

async function observeReplay<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    context: ReplayContext,
    witness: PropertyWitnessFile,
    execution: PropertyExecution<Value>
): Promise<ObservedTrial> {
    const { work, coverage } = execution;
    const host = { ...execution.host, corpus: { checkedIn: [ witness ], localCache: [], diagnostics: [] } };
    const reconstruct = replayInput(invocation, { ...context, host }, work);
    work.enterPhase('witness');
    const observed = await observePropertyTrial(reconstruct(), invocation, {
        async afterTrial() {
            return execution.publish('in-progress', null);
        },
        host,
        signal: context.signal,
        reconstruct,
        work,
        observeLabel: execution.observeLabel,
        observeScores() {
            return undefined;
        },
        observations: coverage.trial('witness')
    });
    await recordReplayResult(execution, observed);
    return observed;
}

async function evaluateReplay<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    context: ReplayContext,
    witness: PropertyWitnessFile
): Promise<ObservedTrial> {
    const execution = createPropertyExecution({ ...invocation, coverage: [] }, context);
    try {
        await execution.publish('in-progress', null);
        return await observeReplay(invocation, context, witness, execution);
    } catch (error: unknown) {
        await execution.publish(context.signal.aborted ? 'interrupted' : 'execution-error', null);
        if (context.signal.aborted) {
            throw error;
        }
        throw propertyReplayError('Property witness replay could not evaluate the retained input.', error);
    }
}

function replayBoundary(observed: ObservedTrial, locations: DefinitionLocations): AssertAssertionNode {
    const { trial } = observed;
    if (trial.kind === 'terminated' || trial.kind === 'body-error') {
        stopPropertyExecution(trial.result);
    }
    return trial.kind === 'assertion-failed' ? trial.assertion : {
        check: 'true',
        actual: true,
        source: 'assert',
        message: 'Property witness input passed.',
        sourceLocations: locations
    };
}

export async function replayPropertyInvocation<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    context: ReplayContext,
    witness: PropertyWitnessFile
): Promise<AssertionResult> {
    return await context.host.recordBoundary(async function replayBoundaryInput() {
        const observed = await evaluateReplay(invocation, context, witness);
        return replayBoundary(observed, context.locations);
    }, context.signal);
}

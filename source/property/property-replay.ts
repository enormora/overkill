import {
    CaseRunnerError,
    stopPropertyExecution,
    type AssertionResult,
    type AssertAssertionNode,
    type DefinitionLocations
} from '../packages/engine/engine.entry-point.ts';
import type { PropertyWitnessFile } from '../engine/witness-file.ts';
import type { NormalizedPropertyInvocation } from './property-definition.ts';
import type { PropertyInvocationContext } from './property-execution-result.ts';
import { propertyRegressionInputs } from './property-regressions.ts';
import { createPropertyWork } from './property-work.ts';
import { invocationCoverage } from './property-coverage.ts';
import { observePropertyTrial, type ObservedTrial } from './property-trial-observation.ts';

type ReplayContext = PropertyInvocationContext & { readonly locations: DefinitionLocations; };

export function propertyReplayError(message: string, cause: unknown): CaseRunnerError {
    return new CaseRunnerError(message, { subtype: 'witness-replay', cause });
}

async function observeReplay<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    context: ReplayContext,
    witness: PropertyWitnessFile
): Promise<ObservedTrial> {
    const work = createPropertyWork(context.host.policy, context.signal);
    const coverage = invocationCoverage([], context.host.policy.maxLabels);
    const host = { ...context.host, corpus: { checkedIn: [ witness ], localCache: [], diagnostics: [] } };
    const inputs = propertyRegressionInputs(invocation, { ...context, host }, work.context, function () {
        return undefined;
    });
    const first = inputs.checkedIn[Symbol.iterator]().next();
    if (first.done === true) {
        throw propertyReplayError('Witness does not match the executing property.', null);
    }
    return await observePropertyTrial(first.value(), invocation, {
        host,
        signal: context.signal,
        reconstruct: first.value,
        work,
        observeLabel: coverage.observeLabel,
        observeScores() {
            return undefined;
        },
        observations: coverage.trial('witness')
    });
}

async function evaluateReplay<Value>(
    invocation: NormalizedPropertyInvocation<Value>,
    context: ReplayContext,
    witness: PropertyWitnessFile
): Promise<ObservedTrial> {
    try {
        return await observeReplay(invocation, context, witness);
    } catch (error: unknown) {
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
    return await context.host.recordBoundary(async function replayInput() {
        const observed = await evaluateReplay(invocation, context, witness);
        await context.host.recordEvidence({
            identity: context.identity,
            confirmedWitness: null,
            shrinkStatus: null,
            original: observed.observation,
            retained: observed.observation,
            diagnostics: []
        });
        return replayBoundary(observed, context.locations);
    }, context.signal);
}

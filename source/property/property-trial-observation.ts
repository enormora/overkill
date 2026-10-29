import {
    type PropertyExecutionHost,
    type PropertyFailureObservation,
    type PropertyTrialResult,
    propertyTrialEvidence
} from '../packages/engine/engine.entry-point.ts';
import { trialFailureKey, type TrialFailureKey } from './property-failure-key.ts';
import { trialTargets, type TrialTargets } from './property-targets.ts';
import type { CoverageTrial } from './property-coverage.ts';
import type { NormalizedPropertyInvocation } from './property-definition.ts';
import type { PropertyWork } from './property-work.ts';

export type ObservedTrial = {
    readonly trial: PropertyTrialResult;
    readonly key: string | null;
    readonly observation: PropertyFailureObservation;
};
type TrialContext = {
    readonly host: PropertyExecutionHost;
    readonly signal: AbortSignal;
    readonly work: PropertyWork;
    readonly observeLabel: (label: string) => void;
    readonly observeScores: (scores: ReadonlyMap<string, number>) => void;
    readonly observations: CoverageTrial;
};

function finishTrial(
    context: TrialContext,
    key: TrialFailureKey,
    targets: TrialTargets,
    passed: boolean
): void {
    key.finish();
    context.observations.finish(passed);
    const scores = targets.finish();
    if (passed) {
        context.observeScores(scores);
    }
}

export async function observePropertyTrial<Value>(
    value: Value,
    preview: PropertyFailureObservation['input'],
    invocation: NormalizedPropertyInvocation<Value>,
    context: TrialContext
): Promise<ObservedTrial> {
    const key = trialFailureKey();
    const targets = trialTargets(context.observeLabel);
    const completion = { passed: false };
    try {
        const trial = await context.host.evaluateTrial(async function runCandidate(scope) {
            context.work.execute();
            return await invocation.test(value, {
                ...scope,
                failureKey: key.set,
                target: targets.target,
                cover: context.observations.cover
            });
        }, context.signal);
        completion.passed = trial.kind === 'passed';
        const failureKey = key.finish();
        return {
            trial,
            key: failureKey,
            observation: { input: preview, failure: propertyTrialEvidence(trial, failureKey) }
        };
    } finally {
        finishTrial(context, key, targets, completion.passed);
    }
}

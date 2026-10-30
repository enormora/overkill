import {
    type EncodedPropertyInput,
    type PropertyExecutionHost,
    type PropertyFailureObservation,
    type PropertyTrialResult,
    serializeValue,
    propertyTrialEvidence
} from '../packages/engine/engine.entry-point.ts';
import { capturePropertyInput } from './property-graph.ts';
import { readGeneratorCodec } from './generator.ts';
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

function failureInput(trial: PropertyTrialResult, input: EncodedPropertyInput): PropertyFailureObservation['capture'] {
    return trial.kind === 'passed' ? { kind: 'unavailable' } : { kind: 'encoded', input };
}

export async function observePropertyTrial<Value>(
    value: Value,
    invocation: NormalizedPropertyInvocation<Value>,
    context: TrialContext
): Promise<ObservedTrial> {
    const capture = capturePropertyInput(value, readGeneratorCodec(invocation.generator), function consumeCodecWork() {
        context.signal.throwIfAborted();
        context.work.context.consumeWork();
    });
    const preview = serializeValue(value);
    const tracking = { key: trialFailureKey(), targets: trialTargets(context.observeLabel), passed: false };
    try {
        const trial = await context.host.evaluateTrial(async function runCandidate(scope) {
            context.work.execute();
            return await invocation.test(value, {
                ...scope,
                failureKey: tracking.key.set,
                target: tracking.targets.target,
                cover: context.observations.cover
            });
        }, context.signal);
        tracking.passed = trial.kind === 'passed';
        const failureKey = tracking.key.finish();
        return {
            trial,
            key: failureKey,
            observation: {
                capture: failureInput(trial, capture),
                input: preview,
                failure: propertyTrialEvidence(trial, failureKey)
            }
        };
    } finally {
        finishTrial(context, tracking.key, tracking.targets, tracking.passed);
    }
}

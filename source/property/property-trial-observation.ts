import {
    type EncodedPropertyInput,
    type PropertyExecutionHost,
    type PropertyFailureObservation,
    type PropertyTrialResult,
    serializeValue,
    propertyTrialEvidence
} from '../packages/engine/engine.entry-point.ts';
import { regressionCapture } from './property-regression-capture.ts';
import { capturePropertyInput } from './property-graph.ts';
import { readGeneratorCodec } from './generator.ts';
import { trialFailureKey, type TrialFailureKey } from './property-failure-key.ts';
import { trialTargets, type TrialTargets } from './property-targets.ts';
import { trialInputReconstruction, type TrialInputReconstruction } from './property-input-reconstruction.ts';
import type { CoverageTrial } from './property-coverage.ts';
import type { NormalizedPropertyInvocation } from './property-definition.ts';
import { propertyExhaustion, propertyTrialPosition, type PropertyWork } from './property-work.ts';

export type ObservedTrial = {
    readonly trial: PropertyTrialResult;
    readonly key: string | null;
    readonly observation: PropertyFailureObservation;
};
type TrialContext<Value> = {
    readonly afterTrial: () => Promise<void>;
    readonly reconstruct: () => Value;
    readonly host: PropertyExecutionHost;
    readonly signal: AbortSignal;
    readonly work: PropertyWork;
    readonly observeLabel: (label: string) => void;
    readonly observeScores: (scores: ReadonlyMap<string, number>) => void;
    readonly observations: CoverageTrial;
};

type TrialTracking = {
    readonly reconstruction: TrialInputReconstruction<unknown>;
    readonly passed: boolean;
    readonly key: TrialFailureKey;
    readonly targets: TrialTargets;
};

function finishTrial(context: TrialContext<unknown>, tracking: TrialTracking): void {
    tracking.reconstruction.finish();
    tracking.key.finish();
    context.observations.finish(tracking.passed);
    const scores = tracking.targets.finish();
    if (tracking.passed) {
        context.observeScores(scores);
    }
}

function failureInput(trial: PropertyTrialResult, input: EncodedPropertyInput): PropertyFailureObservation['capture'] {
    return trial.kind === 'passed' ? { kind: 'unavailable' } : { kind: 'encoded', input };
}

function propagateTrialWorkExhaustion(trial: PropertyTrialResult): PropertyTrialResult {
    if (trial.kind === 'body-error') {
        const error = trial.result.bodyError?.thrown;
        if (error instanceof Error && propertyExhaustion(error) !== null) {
            throw error;
        }
    }
    return trial;
}

export async function observePropertyTrial<Value>(
    value: Value,
    invocation: NormalizedPropertyInvocation<Value>,
    context: TrialContext<Value>
): Promise<ObservedTrial> {
    const capture = regressionCapture(context.reconstruct) ??
        capturePropertyInput(value, readGeneratorCodec(invocation.generator), function consumeCodecWork() {
            context.signal.throwIfAborted();
            context.work.context.consumeWork();
        });
    const preview = serializeValue(value);
    const tracking = {
        key: trialFailureKey(),
        targets: trialTargets(context.observeLabel),
        passed: false,
        reconstruction: trialInputReconstruction(context.reconstruct, context.work.context.consumeWork, context.signal)
    };
    try {
        const trial = propagateTrialWorkExhaustion(
            await context.host.evaluateTrial(async function runCandidate(scope) {
                return await invocation.test(value, {
                    ...scope,
                    reconstructInput: tracking.reconstruction.input,
                    failureKey: tracking.key.set,
                    target: tracking.targets.target,
                    cover: context.observations.cover
                });
            }, context.signal)
        );
        tracking.passed = trial.kind === 'passed';
        const failureKey = tracking.key.finish();
        return {
            trial,
            key: failureKey,
            observation: {
                trial: propertyTrialPosition(context.work),
                capture: failureInput(trial, capture),
                input: preview,
                failure: propertyTrialEvidence(trial, failureKey)
            }
        };
    } finally {
        finishTrial(context, tracking);
        await context.afterTrial();
    }
}

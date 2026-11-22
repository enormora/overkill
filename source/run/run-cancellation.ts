import type { ProfileConfig } from '../config/types.ts';
import { currentReplay } from './replay-context.ts';
import { invalidRequest, supervisedCancellationError } from './run-errors.ts';
import { createResultFromResolutionError, reportCollectionErrorResult } from './run-collection-error-result.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunTimingMeasurement, RunInvocationTimingOptions } from './run-timing-collection.ts';
import type { RunCommand, RunInvocationOptions } from './run-types.ts';
import type { RunOrchestrator } from './run-orchestrator-types.ts';
import { snapshotRunCommand } from './frozen-run-command.ts';
import { selectProfile } from './test-profile.ts';

type CancellationNamespace = 'baseline' | 'bench' | 'bench-calibrate' | 'test';

function supportsCancellation(
    profile: ProfileConfig,
    namespace: CancellationNamespace
): boolean {
    if (namespace === 'baseline') {
        return profile.execution.processModel === 'supervised-process';
    }
    if (namespace !== 'test') {
        return false;
    }
    return profile.execution.processModel === 'supervised-process' ||
        typeof profile.testFamily !== 'string' && profile.testFamily.features.execution === 'analysis';
}

function assertSupervisedTest(
    command: Parameters<RunOrchestrator['run']>[0],
    namespace: CancellationNamespace
): void {
    const snapshot = snapshotRunCommand(command).command;
    const profile = selectProfile(snapshot.request.profile, snapshot.config);
    if (supportsCancellation(profile, namespace)) {
        return;
    }
    if (currentReplay() === null) {
        invalidRequest('Invocation cancellation requires a supervised-process test profile.');
    }
}

export function readRunCancellation(
    command: Parameters<RunOrchestrator['run']>[0],
    namespace: CancellationNamespace,
    options: RunInvocationOptions | RunInvocationTimingOptions | undefined
): Readonly<AbortSignal> | null {
    const signal: unknown = options === undefined ? null : Reflect.get(options, 'signal') ?? null;
    if (signal === null) {
        return null;
    }
    if (!(signal instanceof AbortSignal)) {
        invalidRequest('Invocation cancellation requires an AbortSignal.');
    }
    assertSupervisedTest(command, namespace);
    return signal;
}

export async function cancelledRunResult(
    command: RunCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement | null
): ReturnType<RunOrchestratorDependencies['execute']> {
    return await reportCollectionErrorResult(
        command,
        dependencies,
        createResultFromResolutionError(supervisedCancellationError(), null),
        { timing, benchmarkHost: null }
    );
}

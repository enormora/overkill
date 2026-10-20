import { invalidRequest, supervisedCancellationError } from './run-errors.ts';
import { createResultFromResolutionError, reportCollectionErrorResult } from './run-collection-error-result.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunTimingMeasurement, RunInvocationTimingOptions } from './run-timing-collection.ts';
import type { RunCommand, RunInvocationOptions } from './run-types.ts';
import type { RunOrchestrator } from './run-orchestrator-types.ts';
import { snapshotRunCommand } from './frozen-run-command.ts';
import { selectProfile } from './test-profile.ts';

function assertSupervisedTest(
    command: Parameters<RunOrchestrator['run']>[0],
    namespace: 'bench' | 'bench-calibrate' | 'test'
): void {
    const snapshot = snapshotRunCommand(command).command;
    const profile = selectProfile(snapshot.request.profile, snapshot.config);
    if (namespace !== 'test' || profile.execution.processModel !== 'supervised-process') {
        invalidRequest('Invocation cancellation requires a supervised-process test profile.');
    }
}

export function readRunCancellation(
    command: Parameters<RunOrchestrator['run']>[0],
    namespace: 'bench' | 'bench-calibrate' | 'test',
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
): ReturnType<RunOrchestrator['run']> {
    return await reportCollectionErrorResult(
        command,
        dependencies,
        createResultFromResolutionError(supervisedCancellationError(), null),
        { timing, benchmarkHost: null }
    );
}

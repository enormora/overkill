import { runnerResult } from './runner-result.ts';
import { readResolvedRunInput, type RunInvocation } from './run-input-resolution.ts';
import { cancelledRunResult } from './run-cancellation.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { CollectionSource as RunCollectionSource } from './run-collection-source.ts';
import { emptyTimingSpanMetadata, type RunTimingMeasurement } from './run-timing-collection.ts';
import { executePreparedInvocation } from './prepared-run.ts';
import type { RunRecordSession } from './run-record.ts';
import type { RunnerResult } from './run-types.ts';

type RunResult = Awaited<ReturnType<RunOrchestratorDependencies['execute']>>;

export type RunExecutionInvocation = RunInvocation & {
    readonly signal: Readonly<AbortSignal> | null;
};

function requestedRunRecording(input: Awaited<ReturnType<typeof readResolvedRunInput>>): boolean {
    return input.request.debug.mode !== 'off' || input.request.record || input.request.lastFailed ||
        input.profile.runRecords.persist === 'always';
}

async function executeCommand(
    invocation: RunExecutionInvocation,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement,
    source: RunCollectionSource
): Promise<RunResult> {
    if (invocation.signal?.aborted === true) {
        return await cancelledRunResult(invocation.command, dependencies, timing);
    }
    const resolvedInput = await timing.measureAsync(
        'profile.resolve',
        emptyTimingSpanMetadata(),
        async function readTimedRunInput() {
            return await readResolvedRunInput({ ...invocation, command: invocation.command }, dependencies, source);
        }
    );
    const resolvedCommand = {
        ...invocation.command,
        config: resolvedInput.config,
        engine: resolvedInput.engine,
        request: resolvedInput.request
    };
    const shouldRecord = !resolvedInput.request.coverage &&
        requestedRunRecording(resolvedInput);
    const executeAttempt = async function executeAttempt(record: RunRecordSession | null): Promise<RunResult> {
        return await executePreparedInvocation(invocation, {
            command: resolvedCommand,
            dependencies,
            input: resolvedInput,
            record,
            source,
            timing,
            signal: invocation.signal
        });
    };
    if (!shouldRecord) {
        return await executeAttempt(null);
    }
    const { executeRecordedRun } = await import('./recorded-run.ts');
    return await executeRecordedRun(resolvedCommand.cwd, resolvedInput, dependencies, executeAttempt);
}

export async function executeRunCommand(
    invocation: RunExecutionInvocation,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement,
    source: RunCollectionSource
): Promise<RunnerResult> {
    return runnerResult(await executeCommand(invocation, dependencies, timing, source));
}

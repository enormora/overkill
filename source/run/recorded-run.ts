import { recordUndeliveredRunnerError } from '../engine/reporter-error-delivery-tracking.ts';
import type { RunResult } from '../engine/run-result.ts';
import { createRunRecordDependencies } from './run-record-input.ts';
import { currentExecutionSession } from './execution-session-context.ts';
import { createResultFromResolutionError } from './run-collection-error-result.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { RunRecordError } from './run-record-error.ts';
import { createRunRecordSession, interruptRunRecord, type RunRecordSession } from './run-record.ts';

export type RunRecordExecutionDependencies = Pick<
    RunOrchestratorDependencies,
    'createHistoryStorage' | 'node' | 'runtimeStateStore' | 'wallClock'
>;

function recordingEnabled(input: ResolvedRunInput): boolean {
    return currentExecutionSession() === null && !input.request.coverage &&
        (input.request.record || input.profile.runRecords.persist === 'always');
}

async function completeFailedRecording(record: RunRecordSession, error: RunRecordError): Promise<RunResult> {
    const result = await record.checkpointResult(createResultFromResolutionError(error, null));
    result.runnerErrors.forEach(recordUndeliveredRunnerError);
    return await record.complete(result);
}

export async function executeRecordedRun(
    cwd: string,
    input: ResolvedRunInput,
    dependencies: RunRecordExecutionDependencies,
    execute: (record: RunRecordSession | null) => Promise<RunResult>
): Promise<RunResult> {
    if (!recordingEnabled(input)) {
        return await execute(null);
    }
    const record = createRunRecordSession(cwd, input, await createRunRecordDependencies(input, dependencies));
    try {
        await record.start(null);
        return await record.complete(await execute(record));
    } catch (error: unknown) {
        if (error instanceof RunRecordError) {
            return await completeFailedRecording(record, error);
        }
        return await interruptRunRecord(record, error);
    }
}

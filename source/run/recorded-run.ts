import { withRunIdentity } from '../execution-ownership.ts';
import { recordUndeliveredRunnerError } from '../engine/reporter-error-delivery-tracking.ts';
import type { RunResult } from '../engine/run-result.ts';
import { createRunRecordDependencies, type RunRecordExecutionDependencies } from './run-record-input.ts';
import { resolveRunRecordPersistence } from './run-profile-facts.ts';
import { createResultFromResolutionError } from './run-collection-error-result.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import { RunRecordError, runRecordPersistenceError } from './run-record-error.ts';
import { createRunRecordSession, interruptRunRecord, type RunRecordSession } from './run-record.ts';

function recordingEnabled(input: ResolvedRunInput): boolean {
    return resolveRunRecordPersistence(input.request, input.profile).persist && !input.request.coverage;
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
    return await withRunIdentity(record, async function executeOwnedRun() {
        try {
            await record.start(null);
        } catch (error: unknown) {
            return await completeFailedRecording(record, runRecordPersistenceError(record.path, 'start', error));
        }
        try {
            return await record.complete(await execute(record));
        } catch (error: unknown) {
            if (error instanceof RunRecordError) {
                return await completeFailedRecording(record, error);
            }
            return await interruptRunRecord(record, error);
        }
    });
}

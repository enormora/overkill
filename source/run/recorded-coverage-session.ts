import { recordUndeliveredRunnerError } from '../engine/reporter-error-delivery-tracking.ts';
import type { RunResult } from '../engine/run-result.ts';
import { createResultFromResolutionError, reportCollectionErrorResult } from './run-collection-error-result.ts';
import { RunCollectionError } from './run-errors.ts';
import type { RecordedCoverageExecution, RecordedCoverageRequest } from './recorded-coverage-types.ts';

async function cleanupInterruptedSession(
    session: RecordedCoverageExecution['session'],
    error: unknown
): Promise<never> {
    try {
        await session.dispose();
    } catch (disposeError: unknown) {
        throw new AggregateError([ error, disposeError ], 'Execution and coverage cleanup failed.', {
            cause: disposeError
        });
    }
    throw error;
}

async function disposeCompletedSession(
    session: RecordedCoverageExecution['session'],
    result: RunResult
): Promise<RunResult> {
    try {
        await session.dispose();
        return result;
    } catch (error: unknown) {
        const cleanupError = new RunCollectionError('Coverage cleanup failed.', {
            cause: { error, kind: 'coverage-operation', phase: 'dispose' }
        }, 'coverage');
        const runnerError = cleanupError.runnerError();
        recordUndeliveredRunnerError(runnerError);
        return { ...result, runnerErrors: [ ...result.runnerErrors, runnerError ], status: 'failed' };
    }
}

export async function reportCoverageError(
    request: RecordedCoverageRequest,
    record: RecordedCoverageExecution['record'],
    error: unknown
): Promise<RunResult> {
    const result = await record.checkpointResult(createResultFromResolutionError(error, null));
    return await reportCollectionErrorResult(request.command, request.dependencies, result, request.timing);
}

async function executeOrReport(
    request: RecordedCoverageRequest,
    execution: RecordedCoverageExecution
): Promise<RunResult> {
    try {
        return await request.execute(execution);
    } catch (error: unknown) {
        return await reportCoverageError(request, execution.record, error);
    }
}

export async function executeRecordedCoverageSession(
    request: RecordedCoverageRequest,
    execution: RecordedCoverageExecution
): Promise<RunResult> {
    try {
        const result = await executeOrReport(request, execution);
        return await disposeCompletedSession(execution.session, result);
    } catch (error: unknown) {
        return await cleanupInterruptedSession(execution.session, error);
    }
}

import type { RunResult } from '../engine/run-result.ts';
import { createCoverageRunRecord, type CoverageRunRecord } from './coverage-run-record.ts';
import type { CoverageSession } from './coverage-session.ts';
import { executeRecordedCoverageSession, reportCoverageError } from './recorded-coverage-session.ts';
import { coverageExecutionCompleted, startCoverageSession } from './run-coverage.ts';
import type { RecordedCoverageRequest } from './recorded-coverage-types.ts';
import { interruptRunRecord } from './run-record.ts';

async function runCoverageAttempt(request: RecordedCoverageRequest, attempt: CoverageRunRecord): Promise<RunResult> {
    let session: CoverageSession | null = null;
    try {
        await attempt.start();
        session = await startCoverageSession(attempt.sessionRequest);
    } catch (error: unknown) {
        return await reportCoverageError(request, attempt.record, error);
    }
    return await executeRecordedCoverageSession(request, {
        record: attempt.record,
        session: {
            childProcess: session.childProcess,
            dispose: session.dispose,
            async finalize(result) {
                return await session.finalize(result, coverageExecutionCompleted(result));
            }
        }
    });
}

export async function runRecordedCoverage(request: RecordedCoverageRequest): Promise<RunResult> {
    const attempt = await createCoverageRunRecord(
        request.command.cwd,
        request.input,
        request.dependencies,
        request.timing
    );
    try {
        const result = await runCoverageAttempt(request, attempt);
        return await attempt.record.complete(result);
    } catch (error: unknown) {
        return await interruptRunRecord(attempt.record, error);
    }
}

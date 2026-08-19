import type { TestFailure } from '../engine/run-result.ts';

export function formatFailureSummary(failure: TestFailure): string {
    if (failure.kind === 'assertion') {
        return failure.checks[0].summary;
    }

    if (failure.kind === 'body-error') {
        return failure.error.message;
    }

    if (failure.kind === 'timeout') {
        return `Timed out after ${failure.deadlineMilliseconds} ms.`;
    }

    return failure.summary;
}

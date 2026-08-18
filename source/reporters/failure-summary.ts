import type { TestFailure } from '../engine/run-result.ts';

export function formatFailureSummary(failure: TestFailure): string {
    if (failure.kind === 'assertion') {
        return failure.checks[0].summary;
    }

    if (failure.kind === 'body-error') {
        return failure.error.message;
    }

    return failure.summary;
}

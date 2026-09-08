import type { FailedCheck, SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import type { TestFailure } from '../engine/run-result.ts';

function firstAssertionCheck(failure: TestFailure): FailedCheck | null {
    return failure.kind === 'assertion' ? failure.checks[0] : null;
}

export function primaryFailureSourceLocation(failure: TestFailure): SourceLocation | null {
    return firstAssertionCheck(failure)?.sourceLocations[0] ?? null;
}

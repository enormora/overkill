import type { TestFailure, TestOutcome } from './run-result.ts';
import type { TestPlan } from './test-plan.ts';

export type TestRetryPolicy = {
    readonly maxAttempts: number;
};

export function assertRetryPolicy(policy: TestRetryPolicy | null): void {
    if (policy !== null && (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1)) {
        throw new TypeError('Retry maxAttempts must be a positive safe integer.');
    }
}

function retryableFailure(failure: TestFailure): boolean {
    return [ 'assertion', 'body-error', 'timeout' ].includes(failure.kind);
}

export function assertRetryFamily(policy: TestRetryPolicy | null, testPlan: TestPlan): void {
    if (
        policy !== null && testPlan.cases.some(function isOtherFamily(testCase) {
            return testCase.testFamily !== null && testCase.testFamily !== 'integration';
        })
    ) {
        throw new TypeError('Retries require integration or family-neutral test plans.');
    }
}

function isRetryableOutcome(outcome: TestOutcome | null): boolean {
    return outcome?.kind === 'fail' && outcome.failures.every(retryableFailure);
}

export function retryPolicyAllowsAttempt(
    policy: TestRetryPolicy | null,
    index: number,
    outcome: TestOutcome | null
): boolean {
    return policy !== null && index < policy.maxAttempts && isRetryableOutcome(outcome);
}

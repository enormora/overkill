import type { ExecutedBody } from './body-result.ts';
import { assertionFailure } from './recorded-assertion-failure.ts';
import { assertNonEmptyItems, type AssertionRecorder } from './assertion-recorder.ts';
import type { TestFailure, TestOutcome } from './run-result.ts';

function bodyFailures(executedBody: ExecutedBody): readonly TestFailure[] {
    const failures: TestFailure[] = Array.from(executedBody.contractFailures);

    if (executedBody.bodyError !== null) {
        failures.push({
            error: executedBody.bodyError,
            kind: 'body-error'
        });
    }

    for (const cleanupError of executedBody.cleanupErrors) {
        failures.push({
            error: cleanupError,
            kind: 'cleanup-error'
        });
    }

    return failures;
}

function planFailure(recorder: AssertionRecorder, executedBody: ExecutedBody): TestFailure | null {
    if (
        [
            executedBody.inconclusiveReason !== null,
            executedBody.requireFailed,
            executedBody.contractFailures.length > 0,
            executedBody.bodyError !== null,
            executedBody.cleanupErrors.length > 0,
            executedBody.runnerErrors.length > 0
        ]
            .includes(true)
    ) {
        return null;
    }

    return recorder.validateAssertionCount(executedBody.returnedAssertions.length);
}

function runnerErrorOutcome(executedBody: ExecutedBody): TestOutcome | null {
    const [ runnerError ] = executedBody.runnerErrors;

    if (runnerError === undefined) {
        return { kind: 'pass' };
    }
    if (
        executedBody.runnerErrors.every(function permissionFailure(error) {
            return error.subtype === 'permission';
        })
    ) {
        return null;
    }

    return {
        kind: 'inconclusive',
        reason: runnerError.message
    };
}

export function createBodyOutcome(
    recorder: AssertionRecorder,
    executedBody: ExecutedBody,
    generated: boolean
): TestOutcome | null {
    const failures = [
        assertionFailure(executedBody.returnedAssertions),
        ...bodyFailures(executedBody),
        generated ? null : planFailure(recorder, executedBody)
    ]
        .filter(function isTestFailure(failure): failure is TestFailure {
            return failure !== null;
        });

    if (failures.length === 0) {
        return executedBody.inconclusiveReason === null
            ? runnerErrorOutcome(executedBody)
            : { kind: 'inconclusive', reason: executedBody.inconclusiveReason };
    }

    assertNonEmptyItems(failures, 'Expected test failures to be non-empty.');

    return {
        failures,
        kind: 'fail'
    };
}

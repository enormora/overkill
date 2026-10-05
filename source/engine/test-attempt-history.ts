import { assertNonEmptyItems } from './assertion-recorder.ts';
import type { PerTestResult, TestAttemptResult } from './run-result.ts';

export function resultWithAttemptHistory(
    finalResult: PerTestResult,
    attempts: readonly TestAttemptResult[]
): PerTestResult {
    assertNonEmptyItems(attempts, 'Expected at least one test attempt.');

    return {
        ...finalResult,
        attempts,
        durationMicroseconds: attempts.reduce(function sumDurations(total, attempt) {
            return total + attempt.durationMicroseconds;
        }, 0),
        retried: attempts.length === 1 ? null : { attempts: attempts.length, finalVerdict: finalResult.verdict }
    };
}

export function caseAttemptHistory(finalResult: PerTestResult, results: readonly PerTestResult[]): PerTestResult {
    const attempts = results.map(function recordAttempt(result) {
        return {
            attempt: result.attempts[0].attempt,
            durationMicroseconds: result.durationMicroseconds,
            outcome: result.outcome ?? result.attempts[0].outcome,
            verdict: result.verdict
        };
    });
    return resultWithAttemptHistory(finalResult, attempts);
}

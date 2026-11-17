import type { ResourceCheckSnapshot } from '../resource-check-protocol.ts';
import { currentResourceCheckDelivery } from '../resource-check-delivery.ts';
import { resourceCheckedOutcome } from './resource-check-outcome.ts';
import { caseAttemptHistory, resultWithAttemptHistory } from './test-attempt-history.ts';
import { hasCasePolicyErrors } from './execution-async-leak-policy.ts';
import type { PerTestResult, RunnerError } from './run-result.ts';
import type { ExecuteCaseInput, ReportedCase } from './case-attempt-context.ts';

function resourceCheckSnapshots(input: ExecuteCaseInput): readonly ResourceCheckSnapshot[] {
    return input.context.dependencies.runtimePolicy?.resourceChecks() ?? [];
}
function resourceCheckedVerdict(result: PerTestResult, outcome: PerTestResult['outcome']): PerTestResult['verdict'] {
    const ordinaryVerdict = [ 'pass', 'fail', 'skip', 'inconclusive' ].includes(result.verdict);
    return outcome?.kind === 'fail' && ordinaryVerdict ? 'fail' : result.verdict;
}
function retainedBodyOutcome(result: PerTestResult): PerTestResult['attempts'][number]['outcome'] {
    return result.outcome ?? result.attempts[0].outcome;
}
export async function resourceCheckedAttemptResult(
    result: PerTestResult,
    input: ExecuteCaseInput
): Promise<PerTestResult> {
    const bodyOutcome = retainedBodyOutcome(result);
    const snapshots = resourceCheckSnapshots(input);
    const checkedOutcome = resourceCheckedOutcome(bodyOutcome, snapshots, input.testCase.workId, {
        index: input.attempt
    });
    const outcome = checkedOutcome === bodyOutcome ? result.outcome : checkedOutcome;
    await currentResourceCheckDelivery()?.flush();
    const verdict = resourceCheckedVerdict(result, outcome);
    return {
        ...result,
        outcome,
        verdict,
        attempts: [ {
            ...result.attempts[0],
            benchmark: result.benchmark,
            property: result.property,
            durationMicroseconds: result.durationMicroseconds,
            attempt: { index: input.attempt },
            outcome: outcome ?? bodyOutcome,
            verdict
        } ]
    };
}
function retainedPolicyOutcome(result: PerTestResult): PerTestResult['outcome'] {
    const { outcome } = result;
    if (outcome?.kind !== 'fail') {
        return null;
    }
    const hasResourceFailure = outcome.failures.some(function resourceFailure(failure) {
        return failure.kind === 'resource-check';
    });
    return hasResourceFailure ? outcome : null;
}
export function caseResultWithPolicyErrors(result: PerTestResult, errors: readonly RunnerError[]): PerTestResult {
    return hasCasePolicyErrors(errors)
        ? { ...result, outcome: retainedPolicyOutcome(result), verdict: 'runtime-policy' }
        : result;
}
function caseHistory(completed: ReportedCase, attempts: readonly PerTestResult[]): ReportedCase {
    return { ...completed, result: caseAttemptHistory(completed.result, attempts) };
}

export function appendAttempt(previous: ReportedCase | null, completed: ReportedCase): ReportedCase {
    if (previous === null) {
        return caseHistory(completed, [ completed.result ]);
    }
    return {
        executionWindow: {
            ...completed.executionWindow,
            startedAtMicroseconds: previous.executionWindow.startedAtMicroseconds
        },
        reporterErrors: [ ...previous.reporterErrors, ...completed.reporterErrors ],
        runnerErrors: [ ...previous.runnerErrors, ...completed.runnerErrors ],
        result: resultWithAttemptHistory(completed.result, [
            ...previous.result.attempts,
            ...caseAttemptHistory(completed.result, [ completed.result ]).attempts
        ])
    };
}

import { inspect, isDeepStrictEqual } from 'node:util';
import { workIdentityKey, type PerTestResult, type RunnerError } from '../run/run.entry-point.ts';
import { canonicalWork } from './mutation-catalog.ts';

type TestOutcome = PerTestResult['outcome'];
type NonFailingMutationCase = { readonly kind: 'pass'; } | { readonly kind: 'skip'; };

export type MutationCaseClassification = NonFailingMutationCase | {
    readonly kind: 'error';
    readonly message: string;
} | {
    readonly kind: 'killed' | 'timeout';
    readonly message: string;
    readonly runnerErrors: readonly RunnerError[];
};

function errorOwnsCase(root: string, result: PerTestResult, error: RunnerError): boolean {
    const work = error.attributedToWork ?? null;
    if (work === null || error.attributedTo === null) {
        return false;
    }
    const expected = workIdentityKey(canonicalWork(root, result.workId));
    return workIdentityKey(canonicalWork(root, work)) === expected &&
        workIdentityKey(canonicalWork(root, { ...work, case: error.attributedTo })) === expected;
}

function bodyPolicyError(error: RunnerError): boolean {
    return [ 'runtime-policy', 'permission', 'uncaught-exception', 'unhandled-rejection' ].includes(error.subtype) &&
        typeof error.cause === 'object' && error.cause !== null && Reflect.get(error.cause, 'phase') === 'body';
}

function safelyAttributedError(root: string, result: PerTestResult, error: RunnerError): boolean {
    return errorOwnsCase(root, result, error) && bodyPolicyError(error) &&
        isDeepStrictEqual(error.attributedToAttempt, result.attempts[0].attempt);
}

function supportedOutcome(outcome: TestOutcome): boolean {
    if (outcome?.kind === 'fail') {
        return outcome.failures.every(function supportedFailure(failure) {
            return [ 'assertion', 'body-error', 'test-contract', 'timeout' ].includes(failure.kind);
        });
    }
    return outcome?.kind !== 'inconclusive';
}

function hasFailure(outcome: TestOutcome, kind: 'killed' | 'timeout'): boolean {
    return outcome?.kind === 'fail' && outcome.failures.some(function matchingFailure(failure) {
        return kind === 'timeout' ? failure.kind === 'timeout' : failure.kind !== 'timeout';
    });
}

function consistentOutcome(result: PerTestResult): boolean {
    if (result.outcome === null) {
        return [ 'runtime-policy', 'crashed' ].includes(result.verdict) && result.attempts[0].outcome?.kind !== 'skip';
    }
    return result.verdict === result.outcome.kind && isDeepStrictEqual(result.outcome, result.attempts[0].outcome);
}

function consistentResult(root: string, result: PerTestResult): boolean {
    const attempt = result.attempts[0];
    const work = canonicalWork(root, result.workId);
    return result.attempts.length === 1 && attempt.attempt.index === 0 && result.retried === null &&
        workIdentityKey(work) === workIdentityKey(canonicalWork(root, { ...work, case: result.id })) &&
        result.verdict === attempt.verdict && consistentOutcome(result);
}

function terminalEvidence(result: PerTestResult, errors: readonly RunnerError[]): boolean {
    if (result.verdict === 'crashed') {
        return errors.some(function globalHook(error) {
            return error.subtype === 'uncaught-exception' || error.subtype === 'unhandled-rejection';
        });
    }
    return result.verdict !== 'runtime-policy' || errors.length > 0;
}

function caseKind(result: PerTestResult, errors: readonly RunnerError[]): MutationCaseClassification['kind'] {
    if (result.verdict === 'skip') {
        return 'skip';
    }
    if (!terminalEvidence(result, errors)) {
        return 'error';
    }
    const outcomes = [ result.outcome, result.attempts[0].outcome ];
    if (
        outcomes.some(function timedOut(outcome) {
            return hasFailure(outcome, 'timeout');
        })
    ) {
        return 'timeout';
    }
    const killed = errors.length > 0 || outcomes.some(function killingFailure(outcome) {
        return hasFailure(outcome, 'killed');
    });
    return killed ? 'killed' : 'pass';
}

function caseDiagnostic(root: string, result: PerTestResult, errors: readonly RunnerError[]): string {
    const id = workIdentityKey(canonicalWork(root, result.workId));
    const diagnostic = inspect({ outcome: result.outcome, attempts: result.attempts, runnerErrors: errors }, {
        depth: 6,
        maxArrayLength: null,
        breakLength: Number.POSITIVE_INFINITY
    });
    return `${id}: ${diagnostic}`;
}

export function classifyMutationCase(
    root: string,
    result: PerTestResult,
    errors: readonly RunnerError[]
): MutationCaseClassification {
    const runnerErrors = errors.filter(function attributedError(error) {
        return safelyAttributedError(root, result, error);
    });
    const outcomes = [ result.outcome, result.attempts[0].outcome ];
    const kind = consistentResult(root, result) && outcomes.every(supportedOutcome)
        ? caseKind(result, runnerErrors)
        : 'error';
    if (kind === 'error') {
        return { kind, message: caseDiagnostic(root, result, runnerErrors) };
    }
    if (kind === 'killed' || kind === 'timeout') {
        return { kind, message: caseDiagnostic(root, result, runnerErrors), runnerErrors };
    }
    return { kind };
}

import { serializeValue } from '../compare/serialized-value.ts';
import type {
    HedgedConflictArtifact,
    RunArtifact,
    RunResult,
    TestAttemptResult,
    TestFailure,
    TestOutcome
} from '../engine/run-result.ts';
import type {
    RunRecordArtifact,
    RunRecordTestAttempt,
    RunRecordTestFailure,
    RunRecordTestOutcome
} from './run-record-outcomes.ts';
import type { RunRecordResult } from './run-record-types.ts';

function recordedFailure(failure: TestFailure): RunRecordTestFailure {
    if (failure.kind === 'body-error' || failure.kind === 'cleanup-error') {
        return { ...failure, error: { ...failure.error, thrown: serializeValue(failure.error.thrown) } };
    }

    return failure.kind === 'test-contract' ? { ...failure, actual: serializeValue(failure.actual) } : failure;
}

function recordedOutcome(outcome: TestOutcome | null): RunRecordTestOutcome | null {
    if (outcome?.kind !== 'fail') {
        return outcome;
    }

    const [ first, ...remaining ] = outcome.failures;

    return { ...outcome, failures: [ recordedFailure(first), ...remaining.map(recordedFailure) ] };
}

function isHedgedConflict(artifact: RunArtifact): artifact is HedgedConflictArtifact {
    return artifact.payload.kind === 'hedged-conflict';
}

function recordedAttempts(
    attempts: readonly [TestAttemptResult, ...readonly TestAttemptResult[]]
): readonly [RunRecordTestAttempt, ...readonly RunRecordTestAttempt[]] {
    function recordAttempt(attempt: TestAttemptResult): RunRecordTestAttempt {
        return { ...attempt, outcome: recordedOutcome(attempt.outcome) };
    }
    const [ first, ...remaining ] = attempts;
    return [ recordAttempt(first), ...remaining.map(recordAttempt) ];
}

function recordedArtifact(artifact: RunArtifact): RunRecordArtifact {
    if (!isHedgedConflict(artifact)) {
        return artifact;
    }

    return {
        ...artifact,
        payload: {
            ...artifact.payload,
            authoritative: {
                ...artifact.payload.authoritative,
                attempts: recordedAttempts(artifact.payload.authoritative.attempts),
                outcome: recordedOutcome(artifact.payload.authoritative.outcome)
            },
            conflicting: {
                ...artifact.payload.conflicting,
                attempts: recordedAttempts(artifact.payload.conflicting.attempts),
                outcome: recordedOutcome(artifact.payload.conflicting.outcome)
            }
        }
    };
}

export function recordedRunResult(result: RunResult): RunRecordResult {
    return {
        ...result,
        artifacts: result.artifacts.map(recordedArtifact),
        perTest: result.perTest.map(function recordTestOutcome(test) {
            return { ...test, attempts: recordedAttempts(test.attempts), outcome: recordedOutcome(test.outcome) };
        }),
        runnerErrors: result.runnerErrors.map(function recordErrorCause(error) {
            return { ...error, cause: serializeValue(error.cause) };
        })
    };
}

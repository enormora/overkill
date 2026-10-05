import { serializeValue } from '../compare/serialized-value.ts';
import type { HedgedConflictArtifact, RunArtifact, RunResult, TestFailure, TestOutcome } from '../engine/run-result.ts';
import type { RunRecordArtifact, RunRecordTestFailure, RunRecordTestOutcome } from './run-record-outcomes.ts';
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
                outcome: recordedOutcome(artifact.payload.authoritative.outcome)
            },
            conflicting: {
                ...artifact.payload.conflicting,
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
            return { ...test, outcome: recordedOutcome(test.outcome) };
        }),
        runnerErrors: result.runnerErrors.map(function recordErrorCause(error) {
            return { ...error, cause: serializeValue(error.cause) };
        })
    };
}

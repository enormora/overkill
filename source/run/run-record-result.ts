import { z } from 'zod/v4';
import { resolveSourceLocations } from '../assertion-protocol/source-location.ts';
import { serializeValue, type SerializedValue } from '../compare/serialized-value.ts';
import type { FailedCheck } from '../assertion-protocol/assertion-node-shape.ts';
import type {
    HedgedConflictArtifact,
    RunArtifact,
    RunResult,
    TestAttemptResult,
    TestFailure,
    TestOutcome
} from '../engine/run-result.ts';
import { runDiagnosticsSchema } from './run-result-schema.ts';
import { serializedValueSchema } from './serialized-value-schema.ts';
import type {
    RunRecordArtifact,
    RunRecordTestAttempt,
    RunRecordTestFailure,
    RunRecordTestOutcome
} from './run-record-outcomes.ts';
import type { RunRecordResult } from './run-record-types.ts';

function recordedCheck(check: FailedCheck, convert: (value: unknown) => SerializedValue): FailedCheck {
    if (check.kind === 'foreign') {
        return { ...check, error: { ...check.error, thrown: convert(check.error.thrown) } };
    }
    if (check.kind === 'composite') {
        const [ first, ...remaining ] = check.children;
        return {
            ...check,
            children: [
                recordedCheck(first, convert),
                ...remaining.map(function recordChild(child) {
                    return recordedCheck(child, convert);
                })
            ]
        };
    }
    return check;
}

function recordedFailure(failure: TestFailure, convert: (value: unknown) => SerializedValue): RunRecordTestFailure {
    if (failure.kind === 'body-error' || failure.kind === 'cleanup-error') {
        return { ...failure, error: { ...failure.error, thrown: convert(failure.error.thrown) } };
    }

    if (failure.kind === 'assertion') {
        const [ first, ...remaining ] = failure.checks;
        return {
            ...failure,
            checks: [
                recordedCheck(first, convert),
                ...remaining.map(function recordCheck(check) {
                    return recordedCheck(check, convert);
                })
            ]
        };
    }
    return failure.kind === 'test-contract' ? { ...failure, actual: convert(failure.actual) } : failure;
}

function recordedOutcome(
    outcome: TestOutcome | null,
    convert: (value: unknown) => SerializedValue
): RunRecordTestOutcome | null {
    if (outcome?.kind !== 'fail') {
        return outcome;
    }

    const [ first, ...remaining ] = outcome.failures;

    return {
        ...outcome,
        failures: [
            recordedFailure(first, convert),
            ...remaining.map(function recordFailure(failure) {
                return recordedFailure(failure, convert);
            })
        ]
    };
}

function isHedgedConflict(artifact: RunArtifact): artifact is HedgedConflictArtifact {
    return artifact.payload.kind === 'hedged-conflict';
}

function recordedAttempts(
    attempts: readonly [TestAttemptResult, ...readonly TestAttemptResult[]],
    convert: (value: unknown) => SerializedValue
): readonly [RunRecordTestAttempt, ...readonly RunRecordTestAttempt[]] {
    function recordAttempt(attempt: TestAttemptResult): RunRecordTestAttempt {
        return { ...attempt, outcome: recordedOutcome(attempt.outcome, convert) };
    }
    const [ first, ...remaining ] = attempts;
    return [ recordAttempt(first), ...remaining.map(recordAttempt) ];
}

function recordedArtifact(artifact: RunArtifact, convert: (value: unknown) => SerializedValue): RunRecordArtifact {
    if (!isHedgedConflict(artifact)) {
        return artifact;
    }

    return {
        ...artifact,
        payload: {
            ...artifact.payload,
            authoritative: {
                ...artifact.payload.authoritative,
                attempts: recordedAttempts(artifact.payload.authoritative.attempts, convert),
                outcome: recordedOutcome(artifact.payload.authoritative.outcome, convert)
            },
            conflicting: {
                ...artifact.payload.conflicting,
                attempts: recordedAttempts(artifact.payload.conflicting.attempts, convert),
                outcome: recordedOutcome(artifact.payload.conflicting.outcome, convert)
            }
        }
    };
}

export type SerializedRunDiagnostics = Pick<RunRecordResult, 'artifacts' | 'perTest' | 'runnerErrors'>;
type RunDiagnostics = Pick<RunResult, 'artifacts' | 'perTest' | 'runnerErrors'>;

function convertedDiagnostics(
    result: RunDiagnostics,
    convert: (value: unknown) => SerializedValue
): SerializedRunDiagnostics {
    return {
        artifacts: result.artifacts.map(function recordArtifact(artifact) {
            return recordedArtifact(artifact, convert);
        }),
        perTest: result.perTest.map(function recordTestOutcome(test) {
            return {
                ...test,
                definitionLocations: resolveSourceLocations(test.definitionLocations),
                attempts: recordedAttempts(test.attempts, convert),
                outcome: recordedOutcome(test.outcome, convert)
            };
        }),
        runnerErrors: result.runnerErrors.map(function recordErrorCause(error) {
            return { ...error, cause: convert(error.cause) };
        })
    };
}

const serializedDiagnosticsSchema: z.ZodType<SerializedRunDiagnostics> = z.intersection(
    runDiagnosticsSchema.transform(function parseDiagnosticValues(diagnostics) {
        return convertedDiagnostics(diagnostics, function parseValue(value) {
            return serializedValueSchema.parse(value);
        });
    }),
    z.record(z.string(), z.json())
);

export function serializeRunDiagnostics(result: RunDiagnostics): SerializedRunDiagnostics {
    return serializedDiagnosticsSchema.parse(convertedDiagnostics(result, serializeValue));
}

export function parseSerializedRunDiagnostics(value: unknown): SerializedRunDiagnostics {
    return serializedDiagnosticsSchema.parse(value);
}

export function recordedRunResult(result: RunResult): RunRecordResult {
    return { ...result, ...convertedDiagnostics(result, serializeValue) };
}

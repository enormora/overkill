import type { ResourceCheckFailure } from '../resource-check-protocol.ts';
import type {
    FailedCheck,
    NonEmptyReadonlyArray,
    ResolvableSourceLocation
} from '../assertion-protocol/assertion-node-shape.ts';
import type { RunArtifactId } from './run-artifact.ts';
import type { PropertyInvocationEvidence } from './property-failure-evidence.ts';
import type { TestContractFailureCode } from './test-contract-failure-code.ts';
import type { AttemptId, CaseId, WorkId } from './identity.ts';
import type { BenchmarkExecutionResult } from './benchmark-result.ts';

export type PropertyCaseEvidence = {
    readonly invocations: readonly PropertyInvocationEvidence[];
};

export type TestAttemptResult = {
    readonly property: PropertyCaseEvidence | null;
    readonly benchmark: BenchmarkExecutionResult | null;
    readonly attempt: AttemptId;
    readonly outcome: TestOutcome | null;
    readonly verdict: TestVerdict;
    readonly durationMicroseconds: number;
};

export type RetrySummary = {
    readonly attempts: number;
    readonly finalVerdict: TestVerdict;
};

export type PerTestResult = {
    readonly property: PropertyCaseEvidence | null;
    readonly benchmark: BenchmarkExecutionResult | null;
    readonly attempts: NonEmptyReadonlyArray<TestAttemptResult>;
    readonly retried: RetrySummary | null;
    readonly definitionLocations: NonEmptyReadonlyArray<ResolvableSourceLocation>;
    readonly id: CaseId;
    readonly outcome: TestOutcome | null;
    readonly verdict: TestVerdict;
    readonly workId: WorkId;
    readonly durationMicroseconds: number;
};

export type PassOutcome = {
    readonly checks?: never;
    readonly kind: 'pass';
    readonly reason?: never;
};

export type AssertionTestFailure = {
    readonly checks: NonEmptyReadonlyArray<FailedCheck>;
    readonly kind: 'assertion';
};

type TestErrorDetails = {
    readonly message: string;
    readonly name: string;
    readonly stack: string | null;
    readonly thrown: unknown;
};

export type BodyErrorTestFailure = {
    readonly error: TestErrorDetails;
    readonly kind: 'body-error';
};

export type TestContractFailure = {
    readonly actual: unknown;
    readonly code: TestContractFailureCode;
    readonly expected: string;
    readonly kind: 'test-contract';
    readonly summary: string;
};

type TimeoutTestFailure = {
    readonly deadlineMilliseconds: number;
    readonly elapsedMilliseconds: number;
    readonly kind: 'timeout';
};

type CleanupErrorTestFailure = {
    readonly error: TestErrorDetails;
    readonly kind: 'cleanup-error';
};

export type HedgedDuplicateConflictFailure = {
    readonly artifact: RunArtifactId;
    readonly kind: 'hedged-duplicate-conflict';
    readonly summary: string;
};

export type TestFailure = (readonly [
    AssertionTestFailure,
    BodyErrorTestFailure,
    CleanupErrorTestFailure,
    HedgedDuplicateConflictFailure,
    ResourceCheckFailure,
    TestContractFailure,
    TimeoutTestFailure
])[number];

export type FailOutcome = {
    readonly failures: NonEmptyReadonlyArray<TestFailure>;
    readonly kind: 'fail';
    readonly reason?: never;
};

export type SkipOutcome = {
    readonly checks?: never;
    readonly kind: 'skip';
    readonly reason: string;
};

export type InconclusiveOutcome = {
    readonly checks?: never;
    readonly kind: 'inconclusive';
    readonly reason: string;
};

export type TestOutcome = FailOutcome | InconclusiveOutcome | PassOutcome | SkipOutcome;
export type TestVerdict = TestOutcome['kind'] | 'crashed' | 'process-exhausted' | 'runtime-policy';

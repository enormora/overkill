import type { InvalidDeepAssertionOperand } from '../assertion-protocol/evaluation.ts';
import type { FailedCheck, NonEmptyReadonlyArray, SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import type { CaseId } from './identity.ts';

type RunnerErrorSubtypeByName = {
    readonly attributionDrift: 'attribution-drift';
    readonly crash: 'crash';
    readonly fixture: 'fixture';
    readonly loader: 'loader';
    readonly permission: 'permission';
    readonly reporter: 'reporter';
    readonly resourceExhaustion: 'resource-exhaustion';
    readonly runtimePolicy: 'runtime-policy';
    readonly unhandledRejection: 'unhandled-rejection';
};

type RunnerErrorSubtype = RunnerErrorSubtypeByName[keyof RunnerErrorSubtypeByName];

export type PassOutcome = {
    readonly checks?: never;
    readonly kind: 'pass';
    readonly reason?: never;
};

export type AssertionTestFailure = {
    readonly checks: NonEmptyReadonlyArray<FailedCheck>;
    readonly kind: 'assertion';
};

export type BodyErrorTestFailure = {
    readonly error: {
        readonly message: string;
        readonly name: string;
        readonly stack: string | null;
        readonly thrown: unknown;
    };
    readonly kind: 'body-error';
};

type TestContractFailureCodeByName = {
    readonly deadBuilderAssertion: 'dead-builder-assertion';
    readonly invalidAssertionReference: 'invalid-assertion-reference';
    readonly invalidCompositeResult: 'invalid-composite-result';
    readonly invalidDeepAssertionOperand: 'invalid-deep-assertion-operand';
    readonly invalidPlan: 'invalid-plan';
    readonly invalidTimeoutControl: 'invalid-timeout-control';
    readonly invalidRequireReference: 'invalid-require-reference';
    readonly noAssertions: 'no-assertions';
    readonly pendingInFlightTask: 'pending-in-flight-task';
    readonly pendingAsyncAssertion: 'pending-async-assertion';
    readonly planMismatch: 'plan-mismatch';
    readonly unobservedInFlightTask: 'unobserved-in-flight-task';
};

export type TestContractFailureCode = TestContractFailureCodeByName[keyof TestContractFailureCodeByName];

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
    readonly error: {
        readonly message: string;
        readonly name: string;
        readonly stack: string | null;
        readonly thrown: unknown;
    };
    readonly kind: 'cleanup-error';
};

type TestFailureTypes = readonly [
    AssertionTestFailure,
    BodyErrorTestFailure,
    CleanupErrorTestFailure,
    TestContractFailure,
    TimeoutTestFailure
];

export type TestFailure = TestFailureTypes[number];

export function invalidDeepAssertionOperandFailure(actual: InvalidDeepAssertionOperand): TestContractFailure {
    return {
        actual,
        code: 'invalid-deep-assertion-operand',
        expected: 'non-primitive deep assertion operand',
        kind: 'test-contract',
        summary: 'Deep assertions require non-primitive operands.'
    };
}

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
export type TestVerdict = TestOutcome['kind'] | 'crashed' | 'resource-exhausted' | 'runtime-policy';

export type RunnerError = {
    readonly attributedTo: CaseId | null;
    readonly cause: unknown;
    readonly message: string;
    readonly subtype: RunnerErrorSubtype;
};

export type RunSummary = {
    readonly crashed: number;
    readonly defined: number;
    readonly discovered: number;
    readonly failed: number;
    readonly inconclusive: number;
    readonly passed: number;
    readonly planned: number;
    readonly resourceExhausted: number;
    readonly runtimePolicy: number;
    readonly skipped: number;
};

export type PerTestResult = {
    readonly id: CaseId;
    readonly outcome: TestOutcome | null;
    readonly verdict: TestVerdict;
};

export type RunArtifactScope = {
    readonly activeCases: readonly CaseId[];
    readonly case: CaseId;
    readonly confidence: 'active-case' | 'concurrent-active';
    readonly kind: 'case';
} | {
    readonly kind: 'run';
};

export type RunArtifactId = {
    readonly scope: RunArtifactScope;
    readonly sequence: number;
    readonly subtype: 'log-capture';
};

export type CapturedOutputArtifactPayload = {
    readonly byteLength: number;
    readonly capturedAtMilliseconds: number;
    readonly kind: 'captured-output';
    readonly stream: 'stderr' | 'stdout';
    readonly text: string;
    readonly truncated: boolean;
};

export type RunArtifact = {
    readonly id: RunArtifactId;
    readonly payload: CapturedOutputArtifactPayload;
    readonly source: 'boundary-captured';
};

export type SuiteRunCounts = {
    readonly discovered: number;
    readonly executed: number;
    readonly planned: number;
};

export type ResourceUsageSnapshot = {
    readonly activeResourceCount: number;
    readonly activeResourceTypes: readonly string[];
    readonly capturedAtMilliseconds: number;
    readonly javaScriptEngineHeapBytes: number;
    readonly residentSetBytes: number;
};

export type RunResourceUsage = {
    readonly activeResourceTypes: readonly string[];
    readonly end: ResourceUsageSnapshot;
    readonly peakActiveResourceCount: number;
    readonly peakJavaScriptEngineHeapBytes: number;
    readonly peakResidentSetBytes: number;
    readonly peakResidentSetGrowthBytesPerSecond: number;
    readonly sampleCount: number;
    readonly start: ResourceUsageSnapshot;
};

export type RunResourceUsageTracker = {
    readonly finish: () => RunResourceUsage;
    readonly start: (onSample?: (snapshot: ResourceUsageSnapshot) => void) => void;
};

export type OrphanedNode = {
    readonly definitionLocations: NonEmptyReadonlyArray<SourceLocation>;
    readonly file: string | null;
    readonly kind: 'suite' | 'table' | 'test';
    readonly title: string;
};

export type RunResult = {
    readonly artifacts: readonly RunArtifact[];
    readonly bySuite: Readonly<Record<string, SuiteRunCounts>>;
    readonly orphans: readonly OrphanedNode[];
    readonly perTest: readonly PerTestResult[];
    readonly resourceUsage: RunResourceUsage | null;
    readonly runnerErrors: readonly RunnerError[];
    readonly summary: RunSummary;
    readonly wallTimeMs: number;
};

export function verdictFromOutcome(outcome: TestOutcome): TestVerdict {
    return outcome.kind;
}

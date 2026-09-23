import type { InvalidDeepAssertionOperand } from '../assertion-protocol/evaluation.ts';
import type {
    FailedCheck,
    NonEmptyReadonlyArray,
    ResolvableSourceLocation
} from '../assertion-protocol/assertion-node-shape.ts';
import type { CaseId, WorkId } from './identity.ts';
import type { RunTimings } from './run-timings.ts';

type RunnerErrorSubtypeByName = {
    readonly attributionDrift: 'attribution-drift';
    readonly crash: 'crash';
    readonly fixture: 'fixture';
    readonly loader: 'loader';
    readonly permission: 'permission';
    readonly reporter: 'reporter';
    readonly resourceExhaustion: 'resource-exhaustion';
    readonly runtimeState: 'runtime-state';
    readonly runtimePolicy: 'runtime-policy';
    readonly uncaughtException: 'uncaught-exception';
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

export type HedgedDuplicateConflictFailure = {
    readonly artifact: RunArtifactId;
    readonly kind: 'hedged-duplicate-conflict';
    readonly summary: string;
};

type TestFailureTypes = readonly [
    AssertionTestFailure,
    BodyErrorTestFailure,
    CleanupErrorTestFailure,
    HedgedDuplicateConflictFailure,
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
    readonly attributedToWork?: WorkId | null;
    readonly cause: unknown;
    readonly message: string;
    readonly subtype: RunnerErrorSubtype;
};

type PermissionDeniedRunnerErrorBoundaryByName = {
    readonly inProcess: 'in-process';
    readonly none: null;
    readonly supervisedChild: 'supervised-child';
    readonly workerPoolHost: 'worker-pool-host';
    readonly workerPoolWorker: 'worker-pool-worker';
};

type PermissionDeniedRunnerErrorBoundary =
    PermissionDeniedRunnerErrorBoundaryByName[keyof PermissionDeniedRunnerErrorBoundaryByName];

export type PermissionDeniedRunnerErrorPhase = 'body' | 'collection' | 'load' | 'out-of-test' | 'run' | null;
type PermissionDeniedRunnerErrorHook = 'uncaughtException' | 'unhandledRejection' | null;
type PermissionDeniedRunnerErrorSource = 'diagnostic-channel' | 'throw';

type SerializedPermissionDeniedError = {
    readonly code: string | null;
    readonly message: string;
    readonly name: string;
    readonly permission: string | null;
    readonly resource: string | null;
    readonly stack: string | null;
};

export type PermissionDeniedRunnerErrorCause = {
    readonly boundary: PermissionDeniedRunnerErrorBoundary;
    readonly capability: string | null;
    readonly diagnosticChannel: string | null;
    readonly error: SerializedPermissionDeniedError | null;
    readonly hook: PermissionDeniedRunnerErrorHook;
    readonly kind: 'node-permission-denial';
    readonly permission: string | null;
    readonly phase: PermissionDeniedRunnerErrorPhase;
    readonly resource: string | null;
    readonly source: PermissionDeniedRunnerErrorSource;
};

export type PermissionDeniedRunnerError = RunnerError & {
    readonly cause: PermissionDeniedRunnerErrorCause;
    readonly subtype: 'permission';
};

export type PermissionDeniedRunnerErrorContext = {
    readonly attributedTo: CaseId | null;
    readonly attributedToWork: WorkId | null;
    readonly boundary: PermissionDeniedRunnerErrorBoundary;
    readonly diagnosticChannel: string | null;
    readonly hook: PermissionDeniedRunnerErrorHook;
    readonly phase: PermissionDeniedRunnerErrorPhase;
};

export type PermissionDeniedDiagnostic = {
    readonly channel: string;
    readonly fallbackCapability: string | null;
    readonly message: unknown;
};

type PermissionDeniedCauseInput = {
    readonly capabilityFallback: string | null;
    readonly context: PermissionDeniedRunnerErrorContext;
    readonly diagnosticMessage: unknown;
    readonly error: unknown;
    readonly source: PermissionDeniedRunnerErrorSource;
};

const permissionCapabilities: Readonly<Record<string, string>> = {
    ChildProcess: 'child-process',
    FileSystemRead: 'fs-read',
    FileSystemWrite: 'fs-write',
    Inspector: 'inspector',
    Network: 'net',
    OpenSSLStore: 'openssl-store',
    WASI: 'wasi',
    WorkerThreads: 'worker'
};

function readStringProperty(value: unknown, property: string): string | null {
    if (value === null || typeof value !== 'object') {
        return null;
    }

    const propertyValue: unknown = Reflect.get(value, property);

    return typeof propertyValue === 'string' ? propertyValue : null;
}

function accessDeniedErrorCode(error: unknown): string | null {
    return readStringProperty(error, 'code');
}

function permissionCapability(permission: string | null, fallback: string | null): string | null {
    if (permission === null) {
        return fallback;
    }

    return permissionCapabilities[permission] ?? fallback;
}

function serializedDeniedError(error: unknown): SerializedPermissionDeniedError {
    if (error instanceof Error) {
        return {
            code: accessDeniedErrorCode(error),
            message: error.message,
            name: error.name,
            permission: readStringProperty(error, 'permission'),
            resource: readStringProperty(error, 'resource'),
            stack: error.stack ?? null
        };
    }

    return {
        code: accessDeniedErrorCode(error),
        message: String(error),
        name: 'Error',
        permission: readStringProperty(error, 'permission'),
        resource: readStringProperty(error, 'resource'),
        stack: null
    };
}

function permissionDeniedMessage(permission: string | null, resource: string | null): string {
    const permissionLabel = permission ?? 'unknown permission';

    return resource === null
        ? `Permission denied: ${permissionLabel}.`
        : `Permission denied: ${permissionLabel} for ${resource}.`;
}

function permissionDeniedCause(input: PermissionDeniedCauseInput): PermissionDeniedRunnerErrorCause {
    const permission = readStringProperty(input.error, 'permission') ??
        readStringProperty(input.diagnosticMessage, 'permission');
    const resource = readStringProperty(input.error, 'resource') ??
        readStringProperty(input.diagnosticMessage, 'resource');

    return {
        boundary: input.context.boundary,
        capability: permissionCapability(permission, input.capabilityFallback),
        diagnosticChannel: input.context.diagnosticChannel,
        error: input.error === null ? null : serializedDeniedError(input.error),
        hook: input.context.hook,
        kind: 'node-permission-denial',
        permission,
        phase: input.context.phase,
        resource,
        source: input.source
    };
}

function permissionDeniedRunnerError(
    context: PermissionDeniedRunnerErrorContext,
    cause: PermissionDeniedRunnerErrorCause
): PermissionDeniedRunnerError {
    return {
        attributedTo: context.attributedTo,
        attributedToWork: context.attributedToWork,
        cause,
        message: permissionDeniedMessage(cause.permission, cause.resource),
        subtype: 'permission'
    };
}

function isAccessDeniedError(error: unknown): boolean {
    return accessDeniedErrorCode(error) === 'ERR_ACCESS_DENIED';
}

export function permissionDeniedRunnerErrorFromThrown(
    error: unknown,
    context: PermissionDeniedRunnerErrorContext
): PermissionDeniedRunnerError | null {
    if (!isAccessDeniedError(error)) {
        return null;
    }

    return permissionDeniedRunnerError(
        context,
        permissionDeniedCause({
            capabilityFallback: null,
            context,
            diagnosticMessage: null,
            error,
            source: 'throw'
        })
    );
}

export function permissionDeniedRunnerErrorFromDiagnostic(
    diagnostic: PermissionDeniedDiagnostic,
    context: PermissionDeniedRunnerErrorContext
): PermissionDeniedRunnerError {
    return permissionDeniedRunnerError(
        context,
        permissionDeniedCause({
            capabilityFallback: diagnostic.fallbackCapability,
            context: {
                ...context,
                diagnosticChannel: diagnostic.channel
            },
            diagnosticMessage: diagnostic.message,
            error: null,
            source: 'diagnostic-channel'
        })
    );
}

export function isPermissionDeniedRunnerError(error: RunnerError): error is PermissionDeniedRunnerError {
    return error.subtype === 'permission' &&
        typeof error.cause === 'object' &&
        error.cause !== null &&
        Reflect.get(error.cause, 'kind') === 'node-permission-denial';
}

const caseRunnerErrorBrand = Symbol.for('@overkill-dev/engine/CaseRunnerError');

export type CaseRunnerErrorOptions = {
    readonly cause: unknown;
    readonly subtype: RunnerErrorSubtype;
};

export class CaseRunnerError extends Error {
    private readonly runnerErrorCause: unknown;
    private readonly runnerErrorSubtype: RunnerErrorSubtype;

    public constructor(message: string, options: CaseRunnerErrorOptions) {
        super(message, options);
        this.name = 'CaseRunnerError';
        this.runnerErrorCause = options.cause;
        this.runnerErrorSubtype = options.subtype;

        Object.defineProperty(this, caseRunnerErrorBrand, {
            value: true
        });
    }

    public runnerError(attributedTo: CaseId, attributedToWork: WorkId): RunnerError {
        return {
            attributedTo,
            attributedToWork,
            cause: this.runnerErrorCause,
            message: this.message,
            subtype: this.runnerErrorSubtype
        };
    }
}

function hasCaseRunnerErrorBrand(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    return Reflect.get(value, caseRunnerErrorBrand) === true &&
        typeof Reflect.get(value, 'runnerError') === 'function';
}

export function isCaseRunnerError(value: unknown): value is CaseRunnerError {
    return value instanceof CaseRunnerError || hasCaseRunnerErrorBrand(value);
}

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

export type RunStatus = 'failed' | 'passed';
export type RunPlanStatus = 'empty-selection' | 'empty-shard' | 'planned';

function failingRunConditions(summary: RunSummary, runnerErrors: readonly RunnerError[]): readonly boolean[] {
    return [
        runnerErrors.length > 0,
        summary.crashed > 0,
        summary.failed > 0,
        summary.planned === 0,
        summary.resourceExhausted > 0,
        summary.runtimePolicy > 0
    ];
}

export function runStatusFromSummary(
    summary: RunSummary,
    runnerErrors: readonly RunnerError[]
): RunStatus {
    if (failingRunConditions(summary, runnerErrors).includes(true)) {
        return 'failed';
    }

    return 'passed';
}

export function runStatusFromPlan(
    summary: RunSummary,
    runnerErrors: readonly RunnerError[],
    planStatus: RunPlanStatus
): RunStatus {
    if (runnerErrors.length === 0 && planStatus === 'empty-shard') {
        return 'passed';
    }

    return runStatusFromSummary(summary, runnerErrors);
}

export type PerTestResult = {
    readonly id: CaseId;
    readonly outcome: TestOutcome | null;
    readonly verdict: TestVerdict;
    readonly workId: WorkId;
    readonly durationMicroseconds: number;
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
    readonly subtype: 'hedged-conflict' | 'log-capture';
};

export type CapturedOutputArtifactPayload = {
    readonly byteLength: number;
    readonly capturedAtMicroseconds: number;
    readonly kind: 'captured-output';
    readonly stream: 'stderr' | 'stdout';
    readonly text: string;
    readonly truncated: boolean;
};

export type HedgedConflictEvidence = {
    readonly outcome: TestOutcome | null;
    readonly verdict: TestVerdict;
};

export type HedgedConflictArtifactPayload = {
    readonly authoritative: HedgedConflictEvidence;
    readonly conflicting: HedgedConflictEvidence;
    readonly kind: 'hedged-conflict';
    readonly work: WorkId;
};

export type CapturedOutputArtifact = {
    readonly id: RunArtifactId;
    readonly payload: CapturedOutputArtifactPayload;
    readonly source: 'boundary-captured' | 'native';
};

export type HedgedConflictArtifact = {
    readonly id: RunArtifactId;
    readonly payload: HedgedConflictArtifactPayload;
    readonly source: 'native';
};

export type RunArtifact = CapturedOutputArtifact | HedgedConflictArtifact;

export type SuiteRunCounts = {
    readonly discovered: number;
    readonly executed: number;
    readonly planned: number;
};

export type ResourceUsageSnapshot = {
    readonly activeResourceCount: number;
    readonly activeResourceTypes: readonly string[];
    readonly capturedAtMicroseconds: number;
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
    readonly definitionLocations: NonEmptyReadonlyArray<ResolvableSourceLocation>;
    readonly file: string | null;
    readonly kind: 'suite' | 'table' | 'test';
    readonly title: string;
};

export type RunResult = {
    readonly artifacts: readonly RunArtifact[];
    readonly bySuite: Readonly<Record<string, SuiteRunCounts>>;
    readonly orphans: readonly OrphanedNode[];
    readonly perTest: readonly PerTestResult[];
    readonly planStatus: RunPlanStatus;
    readonly resourceUsage: RunResourceUsage | null;
    readonly runnerErrors: readonly RunnerError[];
    readonly status: RunStatus;
    readonly summary: RunSummary;
    readonly timings: RunTimings;
};

export function verdictFromOutcome(outcome: TestOutcome): TestVerdict {
    return outcome.kind;
}

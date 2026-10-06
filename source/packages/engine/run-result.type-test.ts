import { describe, expect, test } from 'tstyche';
import type {
    RuntimeAttachmentArtifact,
    RuntimeAttachments,
    TestScope,
    CoverageArtifact,
    CoverageArtifactPayload,
    CoverageMetric,
    CoverageReportFile,
    CoverageRunnerError,
    CoverageRunnerErrorCause,
    isPermissionDeniedRunnerError,
    PermissionDeniedRunnerError,
    PermissionDeniedRunnerErrorCause,
    PerTestResult,
    ReporterEvent,
    ResourceUsageSnapshot,
    RunResourceUsage,
    RunResourceUsageTracker,
    RunArtifactId,
    RunPreciseTimingReport,
    RunArtifact,
    RunResult,
    RunPlanStatus,
    RunSummary,
    RunTimings,
    RunnerError,
    RuntimeId,
    WorkloadId,
    AttemptId,
    TestAttemptResult,
    RetrySummary
} from './engine.entry-point.ts';

type OutcomeKind = 'fail' | 'inconclusive' | 'pass' | 'skip';
type ExpectedRunnerErrorSubtypeByName = {
    readonly artifact: 'artifact';
    readonly attributionDrift: 'attribution-drift';
    readonly coverage: 'coverage';
    readonly crash: 'crash';
    readonly fixture: 'fixture';
    readonly loader: 'loader';
    readonly permission: 'permission';
    readonly reporter: 'reporter';
    readonly resourceExhaustion: 'resource-exhaustion';
    readonly runtimePolicy: 'runtime-policy';
    readonly runtimeState: 'runtime-state';
    readonly uncaughtException: 'uncaught-exception';
    readonly unhandledRejection: 'unhandled-rejection';
};
type ExpectedRunnerErrorSubtype = ExpectedRunnerErrorSubtypeByName[keyof ExpectedRunnerErrorSubtypeByName];
type RunResultKeys = readonly [
    'artifacts',
    'bySuite',
    'orphans',
    'perTest',
    'planStatus',
    'resourceUsage',
    'runnerErrors',
    'status',
    'summary',
    'timings'
];
type ExpectedRunResultKey = RunResultKeys[number];
type RunSummaryKeys = readonly [
    'crashed',
    'defined',
    'discovered',
    'failed',
    'inconclusive',
    'passed',
    'planned',
    'resourceExhausted',
    'runtimePolicy',
    'skipped'
];
type ExpectedRunSummaryKey = RunSummaryKeys[number];
type PreciseTimingKeys = readonly [
    'aggregates',
    'ambientNoise',
    'droppedSpanCount',
    'observationWindow',
    'overhead',
    'slowestSpanLimit',
    'slowestSpans',
    'spanLimit',
    'spans',
    'truncated'
];
type ExpectedPreciseTimingKey = PreciseTimingKeys[number];
type TestEndReporterEvent = Extract<ReporterEvent, { readonly kind: 'test-end'; }>;

describe('run result verdicts', function () {
    test('attempt history and completion are required and attribution is nullable', function () {
        expect<PerTestResult['attempts']>().type.toBe<readonly [TestAttemptResult, ...TestAttemptResult[]]>();
        expect<PerTestResult['retried']>().type.toBe<RetrySummary | null>();
        expect<RunnerError['attributedToAttempt']>().type.toBe<AttemptId | null>();
        expect<TestEndReporterEvent['completion']>().type.toBe<'final' | 'retry'>();
    });

    test('artifact attempt identity follows its scope', function () {
        expect<RunArtifactId>().type.toBeAssignableFrom<{
            readonly attempt: AttemptId;
            readonly runtimes: readonly [];
            readonly workload: null;
            readonly sequence: 0;
            readonly subtype: 'log-capture';
            readonly scope: {
                readonly kind: 'case';
                readonly case: PerTestResult['id'];
                readonly activeCases: readonly [];
                readonly confidence: 'active-case';
            };
        }>();
        expect<RunArtifactId>().type.not.toBeAssignableFrom<{
            readonly attempt: null;
            readonly runtimes: readonly [];
            readonly workload: null;
            readonly sequence: 0;
            readonly subtype: 'log-capture';
            readonly scope: {
                readonly kind: 'case';
                readonly case: PerTestResult['id'];
                readonly activeCases: readonly [];
                readonly confidence: 'active-case';
            };
        }>();
    });
    test('per-test and reporter verdicts accept outcomes and terminal runner verdicts', function () {
        expect<PerTestResult['verdict']>().type.toBe<
            OutcomeKind | 'crashed' | 'resource-exhausted' | 'runtime-policy'
        >();
        expect<TestEndReporterEvent['verdict']>().type.toBe<
            OutcomeKind | 'crashed' | 'resource-exhausted' | 'runtime-policy'
        >();
    });
});

describe('RunSummary', function () {
    test('includes terminal runner verdict counts', function () {
        expect<keyof RunSummary>().type.toBe<ExpectedRunSummaryKey>();
    });
});

describe('RunResult', function () {
    test('includes resource usage as nullable measured data', function () {
        expect<keyof RunResult>().type.toBe<ExpectedRunResultKey>();
        expect<RunResult['status']>().type.toBe<'failed' | 'passed'>();
        expect<RunResult['planStatus']>().type.toBe<RunPlanStatus>();
        expect<RunResult['resourceUsage']>().type.toBe<RunResourceUsage | null>();
        expect<RunResult['timings']>().type.toBe<RunTimings>();
        expect<RunTimings['precise']>().type.toBe<RunPreciseTimingReport | null>();
        expect<keyof RunPreciseTimingReport>().type.toBe<ExpectedPreciseTimingKey>();
        expect<RunResourceUsage['start']>().type.toBe<ResourceUsageSnapshot>();
        expect<RunResourceUsageTracker['finish']>().type.toBe<() => RunResourceUsage>();
    });

    test('artifacts carry runtime and workload identity', function () {
        expect<RunArtifactId['runtimes']>().type.toBe<readonly RuntimeId[]>();
        expect<RunArtifactId['workload']>().type.toBe<WorkloadId | null>();
    });
});

describe('coverage artifacts', function () {
    test('are run-scoped V8-native artifacts', function () {
        expect<Extract<RunArtifact, { readonly payload: { readonly kind: 'coverage'; }; }>>()
            .type
            .toBe<CoverageArtifact>();
        expect<CoverageArtifact['id']['scope']>().type.toBe<{ readonly kind: 'run'; }>();
        expect<CoverageArtifact['id']['subtype']>().type.toBe<'coverage'>();
        expect<CoverageArtifact['source']>().type.toBe<'v8-native'>();
        expect<CoverageArtifact['payload']>().type.toBe<CoverageArtifactPayload>();
        expect<CoverageArtifactPayload['reports'][number]>().type.toBe<CoverageReportFile>();
        expect<CoverageArtifactPayload['summary']['lines']>().type.toBe<CoverageMetric>();
    });
});

describe('RunnerError', function () {
    test('subtype is the documented union', function () {
        expect<RunnerError['subtype']>().type.toBe<ExpectedRunnerErrorSubtype>();
    });

    test('permission denial runner error cause is public', function () {
        expect<PermissionDeniedRunnerError['subtype']>().type.toBe<'permission'>();
        expect<PermissionDeniedRunnerError['cause']>().type.toBe<PermissionDeniedRunnerErrorCause>();
        expect<typeof isPermissionDeniedRunnerError>().type.toBe<
            (error: RunnerError) => error is PermissionDeniedRunnerError
        >();
    });

    test('coverage runner error cause is public', function () {
        expect<CoverageRunnerError['subtype']>().type.toBe<'coverage'>();
        expect<CoverageRunnerError['cause']>().type.toBe<CoverageRunnerErrorCause>();
    });
});

describe('runtime attachment contracts', function () {
    test('extends artifacts without extending the base test scope', function () {
        expect<RunArtifact>().type.toBeAssignableFrom<RuntimeAttachmentArtifact>();
        expect<keyof TestScope>().type.not.toBeAssignableFrom<'attachments'>();
        expect<RuntimeAttachments['json']>().type.toBeCallableWith({
            name: 'accessibility',
            mediaType: 'application/json'
        }, { violations: [] });
    });
});

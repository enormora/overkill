import { suite, test } from '@overkill-dev/test';
import { acceptsCall, assignableFrom, sameType } from '@overkill-dev/type-test';
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
    ProcessUsageSnapshot,
    RunProcessUsage,
    RunProcessUsageTracker,
    RunArtifactId,
    RunPreciseTimingReport,
    RunArtifact,
    RunResult,
    ResourceCheckSnapshot,
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
    readonly measurement: 'measurement';
    readonly merge: 'merge';
    readonly permission: 'permission';
    readonly reporter: 'reporter';
    readonly processExhaustion: 'process-exhaustion';
    readonly runtimePolicy: 'runtime-policy';
    readonly runtimeState: 'runtime-state';
    readonly witnessReplay: 'witness-replay';
    readonly uncaughtException: 'uncaught-exception';
    readonly unhandledRejection: 'unhandled-rejection';
};
type ExpectedRunnerErrorSubtype = ExpectedRunnerErrorSubtypeByName[keyof ExpectedRunnerErrorSubtypeByName];
type RunResultKeys = readonly [
    'baselineReports',
    'preparationFacts',
    'artifacts',
    'bySuite',
    'orphans',
    'perTest',
    'planStatus',
    'processUsage',
    'resourceChecks',
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
    'processExhausted',
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

declare const callUnderTest: RuntimeAttachments['json'];

export const testNode = suite('run result', [
    suite('run result verdicts', [
        test('attempt history and completion are required and attribution is nullable', function (typeScope) {
            typeScope.assert(
                sameType<PerTestResult['attempts'], readonly [TestAttemptResult, ...TestAttemptResult[]]>()
            );
            typeScope.assert(sameType<PerTestResult['retried'], RetrySummary | null>());
            typeScope.assert(sameType<RunnerError['attributedToAttempt'], AttemptId | null>());
            typeScope.assert(sameType<TestEndReporterEvent['completion'], 'final' | 'retry'>());
            return typeScope.assert.collect();
        }),
        test('artifact attempt identity follows its scope', function (typeScope) {
            typeScope.assert(assignableFrom<RunArtifactId, {
                readonly attempt: AttemptId;
                readonly familyVariant: null;
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
            }>());
            typeScope.assert(assignableFrom.not<RunArtifactId, {
                readonly attempt: null;
                readonly familyVariant: null;
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
            }>());
            return typeScope.assert.collect();
        }),
        test('per-test and reporter verdicts accept outcomes and terminal runner verdicts', function (typeScope) {
            typeScope.assert(
                sameType<PerTestResult['verdict'], OutcomeKind | 'crashed' | 'process-exhausted' | 'runtime-policy'>()
            );
            typeScope.assert(
                sameType<
                    TestEndReporterEvent['verdict'],
                    OutcomeKind | 'crashed' | 'process-exhausted' | 'runtime-policy'
                >()
            );
            return typeScope.assert.collect();
        })
    ]),
    suite('RunSummary', [
        test('includes terminal runner verdict counts', function (typeScope) {
            typeScope.assert(sameType<keyof RunSummary, ExpectedRunSummaryKey>());
            return typeScope.assert.collect();
        })
    ]),
    suite('RunResult', [
        test('includes process usage as nullable measured data', function (typeScope) {
            typeScope.assert(sameType<keyof RunResult, ExpectedRunResultKey>());
            typeScope.assert(sameType<RunResult['status'], 'failed' | 'passed'>());
            typeScope.assert(sameType<RunResult['planStatus'], RunPlanStatus>());
            typeScope.assert(sameType<RunResult['processUsage'], RunProcessUsage | null>());
            typeScope.assert(sameType<RunResult['resourceChecks'], readonly ResourceCheckSnapshot[]>());
            typeScope.assert(sameType<RunResult['timings'], RunTimings>());
            typeScope.assert(sameType<RunTimings['precise'], RunPreciseTimingReport | null>());
            typeScope.assert(sameType<keyof RunPreciseTimingReport, ExpectedPreciseTimingKey>());
            typeScope.assert(sameType<RunProcessUsage['start'], ProcessUsageSnapshot>());
            typeScope.assert(sameType<RunProcessUsageTracker['finish'], () => RunProcessUsage>());
            return typeScope.assert.collect();
        }),
        test('artifacts carry runtime and workload identity', function (typeScope) {
            typeScope.assert(sameType<RunArtifactId['runtimes'], readonly RuntimeId[]>());
            typeScope.assert(sameType<RunArtifactId['workload'], WorkloadId | null>());
            return typeScope.assert.collect();
        })
    ]),
    suite('coverage artifacts', [
        test('are run-scoped V8-native artifacts', function (typeScope) {
            typeScope.assert(
                sameType<
                    Extract<RunArtifact, { readonly payload: { readonly kind: 'coverage'; }; }>,
                    CoverageArtifact
                >()
            );
            typeScope.assert(sameType<CoverageArtifact['id']['scope'], { readonly kind: 'run'; }>());
            typeScope.assert(sameType<CoverageArtifact['id']['subtype'], 'coverage'>());
            typeScope.assert(sameType<CoverageArtifact['source'], 'v8-native'>());
            typeScope.assert(sameType<CoverageArtifact['payload'], CoverageArtifactPayload>());
            typeScope.assert(sameType<CoverageArtifactPayload['reports'][number], CoverageReportFile>());
            typeScope.assert(sameType<CoverageArtifactPayload['summary']['lines'], CoverageMetric>());
            return typeScope.assert.collect();
        })
    ]),
    suite('RunnerError', [
        test('subtype is the documented union', function (typeScope) {
            typeScope.assert(sameType<RunnerError['subtype'], ExpectedRunnerErrorSubtype>());
            return typeScope.assert.collect();
        }),
        test('permission denial runner error cause is public', function (typeScope) {
            typeScope.assert(sameType<PermissionDeniedRunnerError['subtype'], 'permission'>());
            typeScope.assert(sameType<PermissionDeniedRunnerError['cause'], PermissionDeniedRunnerErrorCause>());
            typeScope.assert(
                sameType<
                    typeof isPermissionDeniedRunnerError,
                    (error: RunnerError) => error is PermissionDeniedRunnerError
                >()
            );
            return typeScope.assert.collect();
        }),
        test('coverage runner error cause is public', function (typeScope) {
            typeScope.assert(sameType<CoverageRunnerError['subtype'], 'coverage'>());
            typeScope.assert(sameType<CoverageRunnerError['cause'], CoverageRunnerErrorCause>());
            return typeScope.assert.collect();
        })
    ]),
    suite('runtime attachment contracts', [
        test('extends artifacts without extending the base test scope', function (typeScope) {
            typeScope.assert(sameType<[RuntimeAttachmentArtifact] extends [RunArtifact] ? true : false, true>());
            typeScope.assert(assignableFrom.not<keyof TestScope, 'attachments'>());
            typeScope.assert(acceptsCall, () =>
                callUnderTest({
                    name: 'accessibility',
                    mediaType: 'application/json'
                }, { violations: [] }));
            return typeScope.assert.collect();
        })
    ])
]);

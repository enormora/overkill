import type { IsEqual } from 'type-fest';
import { suite, test } from '../test/test.entry-point.ts';
import { acceptsCall, assignableFrom, sameType } from '../type-test/type-test.entry-point.ts';
import type { IsAssignable } from '../../test-support/type-relations.ts';
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

export const testNode = suite('Run verdicts, summaries, and artifacts', [
    suite('run result verdicts', [
        test('attempt history and completion are required and attribution is nullable', function (scope) {
            scope.assert(
                sameType<
                    IsEqual<PerTestResult['attempts'], readonly [TestAttemptResult, ...TestAttemptResult[]]>,
                    true
                >()
            );
            scope.assert(sameType<IsEqual<PerTestResult['retried'], RetrySummary | null>, true>());
            scope.assert(sameType<IsEqual<RunnerError['attributedToAttempt'], AttemptId | null>, true>());
            scope.assert(sameType<TestEndReporterEvent['completion'], 'final' | 'retry'>());
            return scope.assert.collect();
        }),
        test('artifact attempt identity follows its scope', function (scope) {
            scope.assert(sameType<
                IsAssignable<{
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
                }, RunArtifactId>,
                true
            >());
            scope.assert(sameType<
                IsAssignable<{
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
                }, RunArtifactId>,
                false
            >());
            return scope.assert.collect();
        }),
        test('per-test and reporter verdicts accept outcomes and terminal runner verdicts', function (scope) {
            scope.assert(
                sameType<
                    IsEqual<PerTestResult['verdict'], OutcomeKind | 'crashed' | 'process-exhausted' | 'runtime-policy'>,
                    true
                >()
            );
            scope.assert(
                sameType<
                    IsEqual<
                        TestEndReporterEvent['verdict'],
                        OutcomeKind | 'crashed' | 'process-exhausted' | 'runtime-policy'
                    >,
                    true
                >()
            );
            return scope.assert.collect();
        })
    ]),
    suite('RunSummary', [
        test('includes terminal runner verdict counts', function (scope) {
            scope.assert(sameType<IsEqual<keyof RunSummary, ExpectedRunSummaryKey>, true>());
            return scope.assert.collect();
        })
    ]),
    suite('RunResult', [
        suite('includes process usage as nullable measured data', [
            test('types measured process usage', function (scope) {
                scope.assert(sameType<IsEqual<keyof RunResult, ExpectedRunResultKey>, true>());
                scope.assert(sameType<RunResult['status'], 'failed' | 'passed'>());
                scope.assert(sameType<IsEqual<RunResult['planStatus'], RunPlanStatus>, true>());
                scope.assert(sameType<IsEqual<RunResult['processUsage'], RunProcessUsage | null>, true>());
                scope.assert(
                    sameType<IsEqual<RunResult['resourceChecks'], readonly ResourceCheckSnapshot[]>, true>()
                );
                return scope.assert.collect();
            }),
            test('types process usage on execution outcomes', function (scope) {
                scope.assert(sameType<IsEqual<RunResult['timings'], RunTimings>, true>());
                scope.assert(sameType<IsEqual<RunTimings['precise'], RunPreciseTimingReport | null>, true>());
                scope.assert(sameType<IsEqual<keyof RunPreciseTimingReport, ExpectedPreciseTimingKey>, true>());
                scope.assert(sameType<IsEqual<RunProcessUsage['start'], ProcessUsageSnapshot>, true>());
                scope.assert(sameType<IsEqual<RunProcessUsageTracker['finish'], () => RunProcessUsage>, true>());
                return scope.assert.collect();
            })
        ]),
        test('artifacts carry runtime and workload identity', function (scope) {
            scope.assert(sameType<IsEqual<RunArtifactId['runtimes'], readonly RuntimeId[]>, true>());
            scope.assert(sameType<IsEqual<RunArtifactId['workload'], WorkloadId | null>, true>());
            return scope.assert.collect();
        })
    ]),
    suite('coverage artifacts', [
        test('are run-scoped V8-native artifacts', function (scope) {
            scope.assert(
                sameType<
                    IsEqual<
                        Extract<RunArtifact, { readonly payload: { readonly kind: 'coverage'; }; }>,
                        CoverageArtifact
                    >,
                    true
                >()
            );
            scope.assert(sameType<IsEqual<CoverageArtifact['id']['scope'], { readonly kind: 'run'; }>, true>());
            scope.assert(sameType<CoverageArtifact['id']['subtype'], 'coverage'>());
            scope.assert(sameType<CoverageArtifact['source'], 'v8-native'>());
            scope.assert(sameType<IsEqual<CoverageArtifact['payload'], CoverageArtifactPayload>, true>());
            scope.assert(sameType<IsEqual<CoverageArtifactPayload['reports'][number], CoverageReportFile>, true>());
            scope.assert(sameType<IsEqual<CoverageArtifactPayload['summary']['lines'], CoverageMetric>, true>());
            return scope.assert.collect();
        })
    ]),
    suite('RunnerError', [
        test('subtype is the documented union', function (scope) {
            scope.assert(sameType<IsEqual<RunnerError['subtype'], ExpectedRunnerErrorSubtype>, true>());
            return scope.assert.collect();
        }),
        test('permission denial runner error cause is public', function (scope) {
            scope.assert(sameType<PermissionDeniedRunnerError['subtype'], 'permission'>());
            scope.assert(
                sameType<IsEqual<PermissionDeniedRunnerError['cause'], PermissionDeniedRunnerErrorCause>, true>()
            );
            scope.assert(
                sameType<
                    IsEqual<
                        typeof isPermissionDeniedRunnerError,
                        (error: RunnerError) => error is PermissionDeniedRunnerError
                    >,
                    true
                >()
            );
            return scope.assert.collect();
        }),
        test('coverage runner error cause is public', function (scope) {
            scope.assert(sameType<CoverageRunnerError['subtype'], 'coverage'>());
            scope.assert(sameType<IsEqual<CoverageRunnerError['cause'], CoverageRunnerErrorCause>, true>());
            return scope.assert.collect();
        })
    ]),
    suite('runtime attachment contracts', [
        test('extends artifacts without extending the base test scope', function (scope) {
            scope.assert(sameType<[RuntimeAttachmentArtifact] extends [RunArtifact] ? true : false, true>());
            scope.assert(assignableFrom.not<keyof TestScope, 'attachments'>());
            scope.assert(acceptsCall, async function () {
                return callUnderTest({
                    name: 'accessibility',
                    mediaType: 'application/json'
                }, { violations: [] });
            });
            return scope.assert.collect();
        })
    ])
]);

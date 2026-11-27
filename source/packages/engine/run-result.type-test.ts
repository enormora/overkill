import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, assignableFrom, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import { type IsAssignable } from '../../test-support/type-relations.ts';
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
                sameType<
                    IsEqual<PerTestResult['attempts'], readonly [TestAttemptResult, ...TestAttemptResult[]]>,
                    true
                >()
            );
            typeScope.assert(sameType<IsEqual<PerTestResult['retried'], RetrySummary | null>, true>());
            typeScope.assert(sameType<IsEqual<RunnerError['attributedToAttempt'], AttemptId | null>, true>());
            typeScope.assert(sameType<TestEndReporterEvent['completion'], 'final' | 'retry'>());
            return typeScope.assert.collect();
        }),
        test('artifact attempt identity follows its scope', function (typeScope) {
            typeScope.assert(sameType<
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
            typeScope.assert(sameType<
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
            return typeScope.assert.collect();
        }),
        test('per-test and reporter verdicts accept outcomes and terminal runner verdicts', function (typeScope) {
            typeScope.assert(
                sameType<
                    IsEqual<PerTestResult['verdict'], OutcomeKind | 'crashed' | 'process-exhausted' | 'runtime-policy'>,
                    true
                >()
            );
            typeScope.assert(
                sameType<
                    IsEqual<
                        TestEndReporterEvent['verdict'],
                        OutcomeKind | 'crashed' | 'process-exhausted' | 'runtime-policy'
                    >,
                    true
                >()
            );
            return typeScope.assert.collect();
        })
    ]),
    suite('RunSummary', [
        test('includes terminal runner verdict counts', function (typeScope) {
            typeScope.assert(sameType<IsEqual<keyof RunSummary, ExpectedRunSummaryKey>, true>());
            return typeScope.assert.collect();
        })
    ]),
    suite('RunResult', [
        suite('includes process usage as nullable measured data', [
            test('types measured process usage', function (typeScope) {
                typeScope.assert(sameType<IsEqual<keyof RunResult, ExpectedRunResultKey>, true>());
                typeScope.assert(sameType<RunResult['status'], 'failed' | 'passed'>());
                typeScope.assert(sameType<IsEqual<RunResult['planStatus'], RunPlanStatus>, true>());
                typeScope.assert(sameType<IsEqual<RunResult['processUsage'], RunProcessUsage | null>, true>());
                typeScope.assert(
                    sameType<IsEqual<RunResult['resourceChecks'], readonly ResourceCheckSnapshot[]>, true>()
                );
                return typeScope.assert.collect();
            }),
            test('types process usage on execution outcomes', function (typeScope) {
                typeScope.assert(sameType<IsEqual<RunResult['timings'], RunTimings>, true>());
                typeScope.assert(sameType<IsEqual<RunTimings['precise'], RunPreciseTimingReport | null>, true>());
                typeScope.assert(sameType<IsEqual<keyof RunPreciseTimingReport, ExpectedPreciseTimingKey>, true>());
                typeScope.assert(sameType<IsEqual<RunProcessUsage['start'], ProcessUsageSnapshot>, true>());
                typeScope.assert(sameType<IsEqual<RunProcessUsageTracker['finish'], () => RunProcessUsage>, true>());
                return typeScope.assert.collect();
            })
        ]),
        test('artifacts carry runtime and workload identity', function (typeScope) {
            typeScope.assert(sameType<IsEqual<RunArtifactId['runtimes'], readonly RuntimeId[]>, true>());
            typeScope.assert(sameType<IsEqual<RunArtifactId['workload'], WorkloadId | null>, true>());
            return typeScope.assert.collect();
        })
    ]),
    suite('coverage artifacts', [
        test('are run-scoped V8-native artifacts', function (typeScope) {
            typeScope.assert(
                sameType<
                    IsEqual<
                        Extract<RunArtifact, { readonly payload: { readonly kind: 'coverage'; }; }>,
                        CoverageArtifact
                    >,
                    true
                >()
            );
            typeScope.assert(sameType<IsEqual<CoverageArtifact['id']['scope'], { readonly kind: 'run'; }>, true>());
            typeScope.assert(sameType<CoverageArtifact['id']['subtype'], 'coverage'>());
            typeScope.assert(sameType<CoverageArtifact['source'], 'v8-native'>());
            typeScope.assert(sameType<IsEqual<CoverageArtifact['payload'], CoverageArtifactPayload>, true>());
            typeScope.assert(sameType<IsEqual<CoverageArtifactPayload['reports'][number], CoverageReportFile>, true>());
            typeScope.assert(sameType<IsEqual<CoverageArtifactPayload['summary']['lines'], CoverageMetric>, true>());
            return typeScope.assert.collect();
        })
    ]),
    suite('RunnerError', [
        test('subtype is the documented union', function (typeScope) {
            typeScope.assert(sameType<IsEqual<RunnerError['subtype'], ExpectedRunnerErrorSubtype>, true>());
            return typeScope.assert.collect();
        }),
        test('permission denial runner error cause is public', function (typeScope) {
            typeScope.assert(sameType<PermissionDeniedRunnerError['subtype'], 'permission'>());
            typeScope.assert(
                sameType<IsEqual<PermissionDeniedRunnerError['cause'], PermissionDeniedRunnerErrorCause>, true>()
            );
            typeScope.assert(
                sameType<
                    IsEqual<
                        typeof isPermissionDeniedRunnerError,
                        (error: RunnerError) => error is PermissionDeniedRunnerError
                    >,
                    true
                >()
            );
            return typeScope.assert.collect();
        }),
        test('coverage runner error cause is public', function (typeScope) {
            typeScope.assert(sameType<CoverageRunnerError['subtype'], 'coverage'>());
            typeScope.assert(sameType<IsEqual<CoverageRunnerError['cause'], CoverageRunnerErrorCause>, true>());
            return typeScope.assert.collect();
        })
    ]),
    suite('runtime attachment contracts', [
        test('extends artifacts without extending the base test scope', function (typeScope) {
            typeScope.assert(sameType<[RuntimeAttachmentArtifact] extends [RunArtifact] ? true : false, true>());
            typeScope.assert(assignableFrom.not<keyof TestScope, 'attachments'>());
            typeScope.assert(acceptsCall, async () =>
                callUnderTest({
                    name: 'accessibility',
                    mediaType: 'application/json'
                }, { violations: [] }));
            return typeScope.assert.collect();
        })
    ])
]);

import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { sameType } from '@overkill-dev/type-test';
import { isAssignableTo, type IsAssignable } from '../../test-support/type-relations.ts';
import {
    defineOutputRenderer,
    defineReporter,
    type ExecuteExecution,
    type ExecuteOptions,
    type ExecuteResultFinalizer,
    type DefinedOutputRenderer,
    type DefinedReporter,
    type FinalResultReporter,
    type FailureArtifactPolicy,
    type NonEmptyReadonlyArray,
    type OutputLineIntent,
    type OutputRenderer,
    type RealTimeReporter,
    type ReportingContext,
    type ReporterOutput,
    type ReporterEvent,
    type RunFacts,
    type RunReport,
    type SinkDeclaration,
    type TestPlan,
    type TestPlanCase,
    type TestPlanCaseExecution,
    type isOutputRenderer,
    type isReporter
} from './engine.entry-point.ts';

type ExecuteOptionKeyByName = {
    readonly debug: true;
    readonly failureArtifacts: true;
    readonly processUsageSamplingIntervalMilliseconds: true;
    readonly execution: true;
    readonly finalizeResult: true;
    readonly outputRenderer: true;
    readonly reporters: true;
    readonly retryPolicy: true;
    readonly processBudgets: true;
    readonly processUsageTracker: true;
    readonly runtimePolicy: true;
    readonly runFacts: true;
    readonly startedAt: true;
    readonly timeoutPolicy: true;
};

type ExpectedExecuteOptionKey = keyof ExecuteOptionKeyByName;
type ExpectedConcurrentExecution = {
    readonly maxConcurrency: number | 'unlimited';
    readonly mode: 'concurrent-in-process';
};
type ExpectedSerialExecution = { readonly mode: 'serial-in-process'; };
type ExpectedExecuteExecution = ExpectedConcurrentExecution | ExpectedSerialExecution;

type SinkKindByName = {
    readonly directory: 'directory';
    readonly file: 'file';
    readonly memory: 'memory';
    readonly stderrManagedPrimary: 'stderr-managed-primary';
    readonly stderrManagedSupplemental: 'stderr-managed-supplemental';
    readonly stderrRaw: 'stderr-raw';
    readonly stdoutManagedPrimary: 'stdout-managed-primary';
    readonly stdoutManagedSupplemental: 'stdout-managed-supplemental';
    readonly stdoutRaw: 'stdout-raw';
    readonly stream: 'stream';
};

type ExpectedSinkKind = SinkKindByName[keyof SinkKindByName];

type RawStdoutRealTimeReporter = RealTimeReporter<readonly [{ readonly kind: 'stdout-raw'; }]>;
type ManagedStdoutRealTimeReporter = RealTimeReporter<readonly [{ readonly kind: 'stdout-managed-primary'; }]>;
type FileAndManagedStderrFinalResultReporter = FinalResultReporter<
    readonly [
        { readonly kind: 'file'; readonly path: 'target/report.json'; },
        { readonly kind: 'stderr-managed-supplemental'; }
    ]
>;
type LateManagedStdoutRealTimeReporter = RealTimeReporter<
    readonly [
        { readonly kind: 'memory'; },
        { readonly kind: 'stream'; readonly provided: WritableStream<unknown>; },
        { readonly kind: 'file'; readonly path: 'target/report.json'; },
        { readonly kind: 'directory'; readonly path: 'target/report-dir'; },
        { readonly kind: 'stdout-managed-supplemental'; }
    ]
>;

export const testNode = suite('Reporter lifecycle, context, and output sinks', [
    suite('uses explicit run facts and nullable finish callbacks', [
        test('types run lifecycle callbacks', function (scope) {
            scope.assert(sameType<IsEqual<keyof ExecuteOptions, ExpectedExecuteOptionKey>, true>());
            scope.assert(
                sameType<IsEqual<ExecuteOptions['outputRenderer'], DefinedOutputRenderer | undefined>, true>()
            );
            scope.assert(
                sameType<IsEqual<ExecuteOptions['finalizeResult'], ExecuteResultFinalizer | undefined>, true>()
            );
            scope.assert(sameType<IsEqual<ExecuteExecution, ExpectedExecuteExecution>, true>());
            scope.assert(sameType<IsEqual<RunFacts, Readonly<Record<string, unknown>>>, true>());
            return scope.assert.collect();
        }),
        test('types nullable completion and execution facts', function (scope) {
            scope.assert(
                sameType<IsEqual<RealTimeReporter['dispose'], (() => Promise<void> | void) | null>, true>()
            );
            scope.assert(
                sameType<IsEqual<RealTimeReporter['onEvent'], (event: ReporterEvent) => Promise<void> | void>, true>()
            );
            scope.assert(
                sameType<
                    IsEqual<RealTimeReporter['onFinish'], ((report: RunReport) => Promise<void> | void) | null>,
                    true
                >()
            );
            scope.assert(
                sameType<IsEqual<FinalResultReporter['dispose'], (() => Promise<void> | void) | null>, true>()
            );
            scope.assert(sameType<FinalResultReporter['kind'], 'final-result'>());
            return scope.assert.collect();
        })
    ]),
    test('allows returned output only for managed output sink reporters', function (scope) {
        scope.assert(
            sameType<
                [(event: ReporterEvent) => ReporterOutput] extends [RawStdoutRealTimeReporter['onEvent']] ? true
                    : false,
                false
            >()
        );
        scope.assert(
            sameType<
                [(report: RunReport) => ReporterOutput] extends [RawStdoutRealTimeReporter['onFinish']] ? true : false,
                false
            >()
        );
        scope.assert(
            sameType<
                [(event: ReporterEvent) => ReporterOutput] extends [ManagedStdoutRealTimeReporter['onEvent']] ? true
                    : false,
                true
            >()
        );
        scope.assert(
            sameType<
                IsAssignable<
                    (report: RunReport) => Promise<ReporterOutput>,
                    FileAndManagedStderrFinalResultReporter['onResult']
                >,
                true
            >()
        );
        scope.assert(
            sameType<
                [(event: ReporterEvent) => ReporterOutput] extends [LateManagedStdoutRealTimeReporter['onEvent']] ? true
                    : false,
                true
            >()
        );
        return scope.assert.collect();
    }),
    test('accepts reporter contexts without diagnostic limits', function (scope) {
        scope.assert(
            sameType<IsEqual<ReportingContext['failureArtifacts'], FailureArtifactPolicy | undefined>, true>()
        );
        return scope.assert.collect();
    }),
    test('exposes sink declarations for every supported sink kind', function (scope) {
        scope.assert(sameType<IsEqual<SinkDeclaration['kind'], ExpectedSinkKind>, true>());
        return scope.assert.collect();
    }),
    test('exposes managed output contracts', function (scope) {
        scope.assert(sameType<OutputLineIntent['kind'], 'stderr-line' | 'stdout-line'>());
        scope.assert(sameType<OutputLineIntent['role'], 'primary' | 'supplemental'>());
        scope.assert(sameType<IsEqual<OutputRenderer['render'], (intent: OutputLineIntent) => string>, true>());
        scope.assert(sameType<IsEqual<ReporterOutput, readonly OutputLineIntent[]>, true>());
        return scope.assert.collect();
    }),
    test('exposes extension branding helpers without replacing structural contracts', function (scope) {
        const context: ReportingContext = {
            relativizeLocationPath(location) {
                return location.file;
            }
        };
        const reporter = defineReporter(function createTypedReporter() {
            return {
                dispose: null,
                kind: 'final-result',
                name: 'typed',
                sinks: [],
                onResult() {
                    return undefined;
                }
            };
        });
        const outputRenderer = defineOutputRenderer(function createTypedOutputRenderer() {
            return {
                render(intent) {
                    return intent.text;
                }
            };
        });

        scope.assert(sameType<[typeof reporter] extends [DefinedReporter] ? true : false, true>());
        scope.assert(sameType.withActual<true>(), isAssignableTo<FinalResultReporter>()(reporter(context)));
        scope.assert(sameType<IsEqual<typeof isReporter, (value: unknown) => value is DefinedReporter>, true>());
        scope.assert(sameType.withActual<true>(), isAssignableTo<DefinedOutputRenderer>()(outputRenderer));
        scope.assert(sameType.withActual<true>(), isAssignableTo<OutputRenderer>()(outputRenderer(context)));
        scope.assert(
            sameType<IsEqual<typeof isOutputRenderer, (value: unknown) => value is DefinedOutputRenderer>, true>()
        );
        return scope.assert.collect();
    }),
    test('exposes non-empty planned case arrays', function (scope) {
        scope.assert(sameType<IsEqual<TestPlan['cases'], NonEmptyReadonlyArray<TestPlanCase>>, true>());
        scope.assert(sameType<IsEqual<TestPlan['discoveredCases'], NonEmptyReadonlyArray<TestPlanCase>>, true>());
        scope.assert(sameType<IsEqual<TestPlanCase['execution'], TestPlanCaseExecution>, true>());
        scope.assert(sameType<
            [{
                readonly body: () => never;
                readonly bodyMode: 'builder';
                readonly kind: 'body';
            }] extends [TestPlanCaseExecution] ? true : false,
            true
        >());
        scope.assert(sameType<
            [{
                readonly body: () => undefined;
                readonly bodyMode: 'throwing';
                readonly kind: 'body';
            }] extends [TestPlanCaseExecution] ? true : false,
            true
        >());
        scope.assert(sameType<
            [{
                readonly kind: 'skip';
                readonly reason: 'unsupported platform';
            }] extends [TestPlanCaseExecution] ? true : false,
            true
        >());
        return scope.assert.collect();
    })
]);

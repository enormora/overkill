import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { sameType } from '../../../tools/type-tests/relations.entry-point.ts';
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

export const testNode = suite('Reporter contract', [
    suite('uses explicit run facts and nullable finish callbacks', [
        test('types run lifecycle callbacks', function (typeScope) {
            typeScope.assert(sameType<IsEqual<keyof ExecuteOptions, ExpectedExecuteOptionKey>, true>());
            typeScope.assert(
                sameType<IsEqual<ExecuteOptions['outputRenderer'], DefinedOutputRenderer | undefined>, true>()
            );
            typeScope.assert(
                sameType<IsEqual<ExecuteOptions['finalizeResult'], ExecuteResultFinalizer | undefined>, true>()
            );
            typeScope.assert(sameType<IsEqual<ExecuteExecution, ExpectedExecuteExecution>, true>());
            typeScope.assert(sameType<IsEqual<RunFacts, Readonly<Record<string, unknown>>>, true>());
            return typeScope.assert.collect();
        }),
        test('types nullable completion and execution facts', function (typeScope) {
            typeScope.assert(
                sameType<IsEqual<RealTimeReporter['dispose'], (() => Promise<void> | void) | null>, true>()
            );
            typeScope.assert(
                sameType<IsEqual<RealTimeReporter['onEvent'], (event: ReporterEvent) => Promise<void> | void>, true>()
            );
            typeScope.assert(
                sameType<
                    IsEqual<RealTimeReporter['onFinish'], ((report: RunReport) => Promise<void> | void) | null>,
                    true
                >()
            );
            typeScope.assert(
                sameType<IsEqual<FinalResultReporter['dispose'], (() => Promise<void> | void) | null>, true>()
            );
            typeScope.assert(sameType<FinalResultReporter['kind'], 'final-result'>());
            return typeScope.assert.collect();
        })
    ]),
    test('allows returned output only for managed output sink reporters', function (typeScope) {
        typeScope.assert(
            sameType<
                [(event: ReporterEvent) => ReporterOutput] extends [RawStdoutRealTimeReporter['onEvent']] ? true
                    : false,
                false
            >()
        );
        typeScope.assert(
            sameType<
                [(report: RunReport) => ReporterOutput] extends [RawStdoutRealTimeReporter['onFinish']] ? true : false,
                false
            >()
        );
        typeScope.assert(
            sameType<
                [(event: ReporterEvent) => ReporterOutput] extends [ManagedStdoutRealTimeReporter['onEvent']] ? true
                    : false,
                true
            >()
        );
        typeScope.assert(
            sameType<
                IsAssignable<
                    (report: RunReport) => Promise<ReporterOutput>,
                    FileAndManagedStderrFinalResultReporter['onResult']
                >,
                true
            >()
        );
        typeScope.assert(
            sameType<
                [(event: ReporterEvent) => ReporterOutput] extends [LateManagedStdoutRealTimeReporter['onEvent']] ? true
                    : false,
                true
            >()
        );
        return typeScope.assert.collect();
    }),
    test('accepts reporter contexts without diagnostic limits', function (typeScope) {
        typeScope.assert(
            sameType<IsEqual<ReportingContext['failureArtifacts'], FailureArtifactPolicy | undefined>, true>()
        );
        return typeScope.assert.collect();
    }),
    test('exposes sink declarations for every supported sink kind', function (typeScope) {
        typeScope.assert(sameType<IsEqual<SinkDeclaration['kind'], ExpectedSinkKind>, true>());
        return typeScope.assert.collect();
    }),
    test('exposes managed output contracts', function (typeScope) {
        typeScope.assert(sameType<OutputLineIntent['kind'], 'stderr-line' | 'stdout-line'>());
        typeScope.assert(sameType<OutputLineIntent['role'], 'primary' | 'supplemental'>());
        typeScope.assert(sameType<IsEqual<OutputRenderer['render'], (intent: OutputLineIntent) => string>, true>());
        typeScope.assert(sameType<IsEqual<ReporterOutput, readonly OutputLineIntent[]>, true>());
        return typeScope.assert.collect();
    }),
    test('exposes extension branding helpers without replacing structural contracts', function (typeScope) {
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

        typeScope.assert(sameType<[typeof reporter] extends [DefinedReporter] ? true : false, true>());
        typeScope.assert(sameType.withActual<true>(), isAssignableTo<FinalResultReporter>()(reporter(context)));
        typeScope.assert(sameType<IsEqual<typeof isReporter, (value: unknown) => value is DefinedReporter>, true>());
        typeScope.assert(sameType.withActual<true>(), isAssignableTo<DefinedOutputRenderer>()(outputRenderer));
        typeScope.assert(sameType.withActual<true>(), isAssignableTo<OutputRenderer>()(outputRenderer(context)));
        typeScope.assert(
            sameType<IsEqual<typeof isOutputRenderer, (value: unknown) => value is DefinedOutputRenderer>, true>()
        );
        return typeScope.assert.collect();
    }),
    test('exposes non-empty planned case arrays', function (typeScope) {
        typeScope.assert(sameType<IsEqual<TestPlan['cases'], NonEmptyReadonlyArray<TestPlanCase>>, true>());
        typeScope.assert(sameType<IsEqual<TestPlan['discoveredCases'], NonEmptyReadonlyArray<TestPlanCase>>, true>());
        typeScope.assert(sameType<IsEqual<TestPlanCase['execution'], TestPlanCaseExecution>, true>());
        typeScope.assert(sameType<
            [{
                readonly body: () => never;
                readonly bodyMode: 'builder';
                readonly kind: 'body';
            }] extends [TestPlanCaseExecution] ? true : false,
            true
        >());
        typeScope.assert(sameType<
            [{
                readonly body: () => undefined;
                readonly bodyMode: 'throwing';
                readonly kind: 'body';
            }] extends [TestPlanCaseExecution] ? true : false,
            true
        >());
        typeScope.assert(sameType<
            [{
                readonly kind: 'skip';
                readonly reason: 'unsupported platform';
            }] extends [TestPlanCaseExecution] ? true : false,
            true
        >());
        return typeScope.assert.collect();
    })
]);

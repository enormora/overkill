import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { assignableTo, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
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
            typeScope.assert(sameType<keyof ExecuteOptions, ExpectedExecuteOptionKey>());
            typeScope.assert(sameType<ExecuteOptions['outputRenderer'], DefinedOutputRenderer | undefined>());
            typeScope.assert(
                sameType<IsEqual<ExecuteOptions['finalizeResult'], ExecuteResultFinalizer | undefined>, true>()
            );
            typeScope.assert(sameType<ExecuteExecution, ExpectedExecuteExecution>());
            typeScope.assert(sameType<RunFacts, Readonly<Record<string, unknown>>>());
            return typeScope.assert.collect();
        }),
        test('types nullable completion and execution facts', function (typeScope) {
            typeScope.assert(sameType<RealTimeReporter['dispose'], (() => Promise<void> | void) | null>());
            typeScope.assert(
                sameType<IsEqual<RealTimeReporter['onEvent'], (event: ReporterEvent) => Promise<void> | void>, true>()
            );
            typeScope.assert(
                sameType<
                    IsEqual<RealTimeReporter['onFinish'], ((report: RunReport) => Promise<void> | void) | null>,
                    true
                >()
            );
            typeScope.assert(sameType<FinalResultReporter['dispose'], (() => Promise<void> | void) | null>());
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
        typeScope.assert(sameType<ReportingContext['failureArtifacts'], FailureArtifactPolicy | undefined>());
        return typeScope.assert.collect();
    }),
    test('exposes sink declarations for every supported sink kind', function (typeScope) {
        typeScope.assert(sameType<SinkDeclaration['kind'], ExpectedSinkKind>());
        return typeScope.assert.collect();
    }),
    test('exposes managed output contracts', function (typeScope) {
        typeScope.assert(sameType<OutputLineIntent['kind'], 'stderr-line' | 'stdout-line'>());
        typeScope.assert(sameType<OutputLineIntent['role'], 'primary' | 'supplemental'>());
        typeScope.assert(sameType<OutputRenderer['render'], (intent: OutputLineIntent) => string>());
        typeScope.assert(sameType<ReporterOutput, readonly OutputLineIntent[]>());
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
        typeScope.assert(sameType<typeof isReporter, (value: unknown) => value is DefinedReporter>());
        typeScope.assert(assignableTo.withActual<DefinedOutputRenderer>(), outputRenderer);
        typeScope.assert(assignableTo.withActual<OutputRenderer>(), outputRenderer(context));
        typeScope.assert(sameType<typeof isOutputRenderer, (value: unknown) => value is DefinedOutputRenderer>());
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

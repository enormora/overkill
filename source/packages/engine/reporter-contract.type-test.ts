import { describe, expect, test } from 'tstyche';
import {
    defineOutputRenderer,
    defineReporter,
    type ExecuteExecution,
    type ExecuteOptions,
    type DefinedOutputRenderer,
    type DefinedReporter,
    type FinalResultReporter,
    type NonEmptyReadonlyArray,
    type OutputLineIntent,
    type OutputRenderer,
    type RealTimeReporter,
    type ReporterOutput,
    type ReporterEvent,
    type RunFacts,
    type RunResult,
    type SinkDeclaration,
    type TestPlan,
    type TestPlanCase,
    type isOutputRenderer,
    type isReporter
} from './engine.entry-point.ts';

type ExecuteOptionKeyByName = {
    readonly execution: true;
    readonly outputRenderer: true;
    readonly reporters: true;
    readonly resourceBudgets: true;
    readonly resourceUsageTracker: true;
    readonly runFacts: true;
    readonly startedAt: true;
    readonly timeoutPolicy: true;
};

type ExpectedExecuteOptionKey = keyof ExecuteOptionKeyByName;

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

describe('Reporter contract', function () {
    test('uses explicit run facts and nullable finish callbacks', function () {
        expect<keyof ExecuteOptions>().type.toBe<ExpectedExecuteOptionKey>();
        expect<ExecuteOptions['outputRenderer']>().type.toBe<OutputRenderer | undefined>();
        expect<ExecuteExecution['mode']>().type.toBe<'concurrent-in-process' | 'serial-in-process'>();
        expect<RunFacts>().type.toBe<Readonly<Record<string, unknown>>>();
        expect<RealTimeReporter['dispose']>().type.toBe<(() => Promise<void> | void) | null>();
        expect<RealTimeReporter['onEvent']>().type.toBe<(event: ReporterEvent) => Promise<void> | void>();
        expect<RealTimeReporter['onFinish']>().type.toBe<((result: RunResult) => Promise<void> | void) | null>();
        expect<FinalResultReporter['dispose']>().type.toBe<(() => Promise<void> | void) | null>();
        expect<FinalResultReporter['kind']>().type.toBe<'final-result'>();
    });

    test('allows returned output only for managed output sink reporters', function () {
        expect<RawStdoutRealTimeReporter['onEvent']>().type.not.toBeAssignableFrom<
            (event: ReporterEvent) => ReporterOutput
        >();
        expect<RawStdoutRealTimeReporter['onFinish']>().type.not.toBeAssignableFrom<
            (result: RunResult) => ReporterOutput
        >();
        expect<ManagedStdoutRealTimeReporter['onEvent']>().type.toBeAssignableFrom<
            (event: ReporterEvent) => ReporterOutput
        >();
        expect<FileAndManagedStderrFinalResultReporter['onResult']>().type.toBeAssignableFrom<
            (result: RunResult) => Promise<ReporterOutput>
        >();
        expect<LateManagedStdoutRealTimeReporter['onEvent']>().type.toBeAssignableFrom<
            (event: ReporterEvent) => ReporterOutput
        >();
    });

    test('exposes sink declarations for every supported sink kind', function () {
        expect<SinkDeclaration['kind']>().type.toBe<ExpectedSinkKind>();
    });

    test('exposes managed output contracts', function () {
        expect<OutputLineIntent['kind']>().type.toBe<'stderr-line' | 'stdout-line'>();
        expect<OutputLineIntent['role']>().type.toBe<'primary' | 'supplemental'>();
        expect<OutputRenderer['render']>().type.toBe<(intent: OutputLineIntent) => string>();
        expect<ReporterOutput>().type.toBe<readonly OutputLineIntent[]>();
    });

    test('exposes extension branding helpers without replacing structural contracts', function () {
        const reporter = defineReporter({
            dispose: null,
            kind: 'final-result',
            name: 'typed',
            sinks: [],
            onResult() {
                return undefined;
            }
        });
        const outputRenderer = defineOutputRenderer({
            render(intent) {
                return intent.text;
            }
        });

        expect(reporter).type.toBeAssignableTo<DefinedReporter>();
        expect(reporter).type.toBeAssignableTo<FinalResultReporter>();
        expect<typeof isReporter>().type.toBe<(value: unknown) => value is DefinedReporter>();
        expect(outputRenderer).type.toBeAssignableTo<DefinedOutputRenderer>();
        expect(outputRenderer).type.toBeAssignableTo<OutputRenderer>();
        expect<typeof isOutputRenderer>().type.toBe<(value: unknown) => value is DefinedOutputRenderer>();
    });

    test('exposes non-empty planned case arrays', function () {
        expect<TestPlan['cases']>().type.toBe<NonEmptyReadonlyArray<TestPlanCase>>();
        expect<TestPlan['discoveredCases']>().type.toBe<NonEmptyReadonlyArray<TestPlanCase>>();
    });
});

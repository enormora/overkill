import { describe, expect, test } from 'tstyche';
import type {
    ExecuteExecution,
    ExecuteOptions,
    FinalResultReporter,
    NonEmptyReadonlyArray,
    OutputLineIntent,
    OutputRenderer,
    RealTimeReporter,
    ReporterOutput,
    RunFacts,
    RunResult,
    SinkDeclaration,
    TestPlan,
    TestPlanCase
} from './engine.entry-point.ts';

type ExecuteOptionKeyByName = {
    readonly execution: true;
    readonly outputRenderer: true;
    readonly reporters: true;
    readonly runFacts: true;
    readonly startedAt: true;
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

describe('Reporter contract', function () {
    test('uses explicit run facts and nullable finish callbacks', function () {
        expect<keyof ExecuteOptions>().type.toBe<ExpectedExecuteOptionKey>();
        expect<ExecuteOptions['outputRenderer']>().type.toBe<OutputRenderer | undefined>();
        expect<ExecuteExecution['mode']>().type.toBe<'concurrent-in-process' | 'serial-in-process'>();
        expect<RunFacts>().type.toBe<Readonly<Record<string, unknown>>>();
        expect<RealTimeReporter['dispose']>().type.toBe<(() => Promise<void> | void) | null>();
        expect<RealTimeReporter['onFinish']>().type.toBe<
            ((result: RunResult) => Promise<ReporterOutput | undefined> | ReporterOutput | undefined) | null
        >();
        expect<FinalResultReporter['dispose']>().type.toBe<(() => Promise<void> | void) | null>();
        expect<FinalResultReporter['kind']>().type.toBe<'final-result'>();
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

    test('exposes non-empty planned case arrays', function () {
        expect<TestPlan['cases']>().type.toBe<NonEmptyReadonlyArray<TestPlanCase>>();
        expect<TestPlan['discoveredCases']>().type.toBe<NonEmptyReadonlyArray<TestPlanCase>>();
    });
});

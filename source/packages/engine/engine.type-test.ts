import { describe, expect, test } from 'tstyche';
import type {
    CaseId,
    ExecuteOptions,
    FailedCheck,
    FinalResultReporter,
    NonEmptyReadonlyArray,
    PerTestResult,
    RealTimeReporter,
    ReporterEvent,
    RunFacts,
    RunResult,
    RunnerError,
    RunSummary,
    SinkDeclaration,
    TestPlan,
    TestPlanCase,
    TestFailure,
    TestOutcome
} from './engine.entry-point.ts';

type FailedCheckFixture = {
    readonly actual: 'actual';
    readonly expected: 'expected';
    readonly id: '1';
    readonly location: { readonly column: null; readonly file: ''; readonly line: null; };
    readonly path: readonly [];
    readonly summary: 'numbers differ';
};

type OutcomeKind = 'fail' | 'inconclusive' | 'pass' | 'skip';
type ExpectedRunnerErrorSubtypeByName = {
    readonly attributionDrift: 'attribution-drift';
    readonly crash: 'crash';
    readonly fixture: 'fixture';
    readonly loader: 'loader';
    readonly permission: 'permission';
    readonly reporter: 'reporter';
    readonly unhandledRejection: 'unhandled-rejection';
};
type ExpectedRunnerErrorSubtype = ExpectedRunnerErrorSubtypeByName[keyof ExpectedRunnerErrorSubtypeByName];
type CaseIdFixture = {
    readonly file: null;
    readonly name: 'case';
    readonly params: null;
    readonly suite: readonly ['suite'];
};
type TestEndReporterEvent = Extract<ReporterEvent, { readonly kind: 'test-end'; }>;
type TestStartReporterEvent = Extract<ReporterEvent, { readonly kind: 'test-start'; }>;
type SuiteStartReporterEvent = Extract<ReporterEvent, { readonly kind: 'suite-start'; }>;

describe('TestOutcome', function () {
    test('accepts public outcome shapes', function () {
        expect<TestOutcome>().type.toBeAssignableFrom<{ readonly kind: 'pass'; }>();
        expect<TestOutcome>().type.toBeAssignableFrom<{
            readonly failures: readonly [
                {
                    readonly checks: readonly [FailedCheckFixture];
                    readonly kind: 'assertion';
                }
            ];
            readonly kind: 'fail';
        }>();
        expect<TestOutcome>().type.toBeAssignableFrom<{ readonly kind: 'skip'; readonly reason: 'filtered'; }>();
        expect<TestOutcome>().type.toBeAssignableFrom<{
            readonly kind: 'inconclusive';
            readonly reason: 'adapter lost result';
        }>();
    });

    test('rejects mixed public outcome shapes', function () {
        expect<TestOutcome>().type.not.toBeAssignableFrom<{
            readonly checks: readonly [];
            readonly kind: 'pass';
        }>();
        expect<TestOutcome>().type.not.toBeAssignableFrom<{
            readonly kind: 'pass';
            readonly reason: null;
        }>();
        expect<TestOutcome>().type.not.toBeAssignableFrom<{
            readonly checks: readonly [FailedCheckFixture];
            readonly kind: 'skip';
            readonly reason: 'filtered';
        }>();
        expect<TestOutcome>().type.not.toBeAssignableFrom<{
            readonly checks: readonly [FailedCheckFixture];
            readonly kind: 'inconclusive';
            readonly reason: 'adapter lost result';
        }>();
        expect<TestOutcome>().type.not.toBeAssignableFrom<{ readonly kind: 'fail'; }>();
        expect<TestOutcome>().type.not.toBeAssignableFrom<{
            readonly checks: readonly [FailedCheckFixture];
            readonly kind: 'fail';
            readonly reason: null;
        }>();
        expect<TestOutcome>().type.not.toBeAssignableFrom<{
            readonly failures: readonly [];
            readonly kind: 'fail';
        }>();
        expect<TestOutcome>().type.not.toBeAssignableFrom<{ readonly kind: 'skip'; }>();
        expect<TestOutcome>().type.not.toBeAssignableFrom<{ readonly kind: 'inconclusive'; }>();
    });

    test('keeps failed checks free of diff fields', function () {
        expect<keyof FailedCheck>().type.toBe<'actual' | 'expected' | 'id' | 'location' | 'path' | 'summary'>();
    });

    test('accepts public test failure shapes', function () {
        expect<TestFailure>().type.toBeAssignableFrom<{
            readonly checks: readonly [FailedCheckFixture];
            readonly kind: 'assertion';
        }>();
        expect<TestFailure>().type.toBeAssignableFrom<{
            readonly error: {
                readonly message: 'boom';
                readonly name: 'Error';
                readonly stack: null;
                readonly thrown: unknown;
            };
            readonly kind: 'body-error';
        }>();
        expect<TestFailure>().type.toBeAssignableFrom<{
            readonly actual: 1;
            readonly code: 'plan-mismatch';
            readonly expected: '2';
            readonly kind: 'test-contract';
            readonly summary: 'Assertion plan count did not match.';
        }>();
    });
});

describe('run result verdicts', function () {
    test('per-test and reporter verdicts accept only outcome kinds', function () {
        expect<PerTestResult['verdict']>().type.toBe<OutcomeKind>();
        expect<TestEndReporterEvent['verdict']>().type.toBe<OutcomeKind>();
    });
});

describe('CaseId', function () {
    test('accepts structured public identity shapes', function () {
        expect<CaseId>().type.toBeAssignableFrom<CaseIdFixture>();
        expect<PerTestResult['id']>().type.toBe<CaseId>();
        expect<TestStartReporterEvent['case']>().type.toBe<CaseId>();
        expect<SuiteStartReporterEvent['suitePath']>().type.toBe<readonly string[]>();
        expect<RunnerError['attributedTo']>().type.toBe<CaseId | null>();
    });

    test('requires explicit nullable identity fields', function () {
        expect<CaseId>().type.not.toBeAssignableFrom<{
            readonly name: 'case';
            readonly suite: readonly ['suite'];
        }>();
        expect<CaseId>().type.not.toBeAssignableFrom<{
            readonly file: null;
            readonly name: 'case';
            readonly suite: readonly ['suite'];
        }>();
    });
});

describe('RunSummary', function () {
    test('includes planned as a public run count', function () {
        expect<keyof RunSummary>().type.toBe<
            'defined' | 'discovered' | 'failed' | 'inconclusive' | 'passed' | 'planned' | 'skipped'
        >();
    });
});

describe('RunnerError', function () {
    test('subtype is the documented union', function () {
        expect<RunnerError['subtype']>().type.toBe<ExpectedRunnerErrorSubtype>();
    });
});

describe('Reporter contract', function () {
    test('uses explicit run facts and nullable finish callbacks', function () {
        expect<keyof ExecuteOptions>().type.toBe<'reporters' | 'runFacts' | 'startedAt'>();
        expect<RunFacts>().type.toBe<Readonly<Record<string, unknown>>>();
        expect<RealTimeReporter['onFinish']>().type.toBe<((result: RunResult) => Promise<void> | void) | null>();
        expect<FinalResultReporter['kind']>().type.toBe<'final-result'>();
    });

    test('exposes sink declarations for every supported sink kind', function () {
        expect<SinkDeclaration['kind']>().type.toBe<'directory' | 'file' | 'memory' | 'stderr' | 'stdout' | 'stream'>();
    });

    test('exposes non-empty planned case arrays', function () {
        expect<TestPlan['cases']>().type.toBe<NonEmptyReadonlyArray<TestPlanCase>>();
        expect<TestPlan['discoveredCases']>().type.toBe<NonEmptyReadonlyArray<TestPlanCase>>();
    });
});

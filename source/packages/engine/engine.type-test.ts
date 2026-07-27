import { describe, expect, test } from 'tstyche';
import type {
    AssertAssertionFacade,
    AssertAssertionNode,
    AssertionNode,
    AssertionOptions,
    AssertionResult,
    AssertionSource,
    CaseAssertContext,
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
    RequireAssertionFacade,
    RequireAssertionNode,
    TestPlan,
    TestPlanCase,
    TestContext,
    TestFailure,
    TestOutcome
} from './engine.entry-point.ts';

type FailedCheckFixture = {
    readonly actual: 'actual';
    readonly expected: 'expected';
    readonly id: '1';
    readonly location: { readonly column: null; readonly file: ''; readonly line: null; };
    readonly path: readonly [];
    readonly source: 'assert';
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
type ExpectedAssertFacadeKeys = keyof {
    readonly annotated: true;
    readonly array: true;
    readonly arrayContainsPartial: true;
    readonly between: true;
    readonly boolean: true;
    readonly deepEqual: true;
    readonly defined: true;
    readonly empty: true;
    readonly endsWith: true;
    readonly equal: true;
    readonly fail: true;
    readonly false: true;
    readonly function: true;
    readonly greaterThan: true;
    readonly greaterThanOrEqual: true;
    readonly hasProperty: true;
    readonly includes: true;
    readonly instanceOf: true;
    readonly length: true;
    readonly lessThan: true;
    readonly lessThanOrEqual: true;
    readonly match: true;
    readonly membersPartialDeepEqual: true;
    readonly notDeepEqual: true;
    readonly notEmpty: true;
    readonly notEqual: true;
    readonly notMatch: true;
    readonly notNull: true;
    readonly null: true;
    readonly number: true;
    readonly object: true;
    readonly partialDeepEqual: true;
    readonly startsWith: true;
    readonly string: true;
    readonly true: true;
    readonly undefined: true;
};
type ExpectedCaseAssertContextKeys = ExpectedAssertFacadeKeys | 'done';
type ExpectedRequireFacadeKeys = keyof {
    readonly annotated: true;
    readonly array: true;
    readonly boolean: true;
    readonly defined: true;
    readonly function: true;
    readonly hasProperty: true;
    readonly instanceOf: true;
    readonly notNull: true;
    readonly null: true;
    readonly number: true;
    readonly object: true;
    readonly string: true;
};

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
        expect<keyof FailedCheck>().type.toBe<
            'actual' | 'expected' | 'id' | 'location' | 'path' | 'source' | 'summary'
        >();
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

describe('Assertion protocol', function () {
    test('exports source-discriminated assertion nodes', function () {
        expect<AssertionSource>().type.toBe<'assert' | 'require'>();
        expect<AssertionNode>().type.toBe<AssertAssertionNode | RequireAssertionNode>();
        expect<AssertionResult>().type.toBe<AssertAssertionNode | NonEmptyReadonlyArray<AssertAssertionNode>>();
        expect<AssertionResult>().type.not.toBeAssignableFrom<readonly []>();
        expect<AssertionResult>().type.not.toBeAssignableFrom<{
            readonly actual: 'value';
            readonly check: 'string';
            readonly message: null;
            readonly source: 'require';
        }>();
    });

    test('exposes the concept assert catalog without ok', function () {
        expect<keyof AssertAssertionFacade>().type.toBe<ExpectedAssertFacadeKeys>();
        expect<keyof AssertAssertionFacade>().type.not.toBeAssignableFrom<'done'>();
    });

    test('keeps builder completion on the case assert context only', function () {
        expect<keyof CaseAssertContext>().type.toBe<ExpectedCaseAssertContextKeys>();
    });

    test('exposes the narrow require catalog without equality or done', function () {
        expect<keyof RequireAssertionFacade>().type.toBe<ExpectedRequireFacadeKeys>();
    });

    test('uses explicit message options and facades on test context', function () {
        expect<AssertionOptions>().type.toBe<{ readonly message: string; }>();
        expect<TestContext['assert']>().type.toBe<CaseAssertContext>();
        expect<TestContext['require']>().type.toBe<RequireAssertionFacade>();
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
        expect<RealTimeReporter['dispose']>().type.toBe<(() => Promise<void> | void) | null>();
        expect<RealTimeReporter['onFinish']>().type.toBe<((result: RunResult) => Promise<void> | void) | null>();
        expect<FinalResultReporter['dispose']>().type.toBe<(() => Promise<void> | void) | null>();
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

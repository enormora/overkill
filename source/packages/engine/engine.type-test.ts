import { describe, expect, test } from 'tstyche';
import {
    defineCompositeAssertion,
    defineNarrowingCompositeAssertion,
    type AssertReferenceArguments,
    type AssertReferenceReturn,
    type CompositeCheckBuilder
} from '../assert/assert.entry-point.ts';
import type {
    AssertAssertionFacade,
    AssertAssertionNode,
    AssertionNode,
    AssertionOptions,
    AssertionResult,
    AssertionSource,
    TestScopeAssertContext,
    CaseId,
    captureSourceLocation,
    DeepComparable,
    Diff,
    DiffPathSegment,
    ErrorMatcher,
    ExactThrownMatcher,
    FailedCheck,
    FailedCompositeCheck,
    FailedForeignCheck,
    FailedLeafCheck,
    NonEmptyReadonlyArray,
    PerTestResult,
    ReporterEvent,
    RequireAssertionFacade,
    RequireAssertionNode,
    ResourceUsageSnapshot,
    ResolvableSourceLocation,
    RunResourceUsage,
    RunResourceUsageTracker,
    RunResult,
    RunSummary,
    RunnerError,
    SerializationTruncation,
    SerializedValue,
    SourceLocation,
    SourceLocationProvider,
    TestScope,
    TestFailure,
    TestOutcome,
    ThrownMatcher,
    unknownSourceLocation
} from './engine.entry-point.ts';

type FailedCheckFixture = {
    readonly actual: { readonly kind: 'number'; readonly value: 1; };
    readonly diff: null;
    readonly expected: { readonly kind: 'undefined'; };
    readonly id: '1';
    readonly kind: 'leaf';
    readonly location: { readonly column: null; readonly file: ''; readonly line: null; };
    readonly path: readonly [];
    readonly source: 'assert';
    readonly summary: 'numbers differ';
};

type FailedCheckKeyByName = {
    readonly actual: true;
    readonly diff: true;
    readonly expected: true;
    readonly id: true;
    readonly kind: true;
    readonly location: true;
    readonly path: true;
    readonly source: true;
    readonly summary: true;
};

type FailedLeafCheckKey = keyof FailedCheckKeyByName;

type FailedCompositeCheckKeyByName = FailedCheckKeyByName & {
    readonly children: true;
};

type FailedCompositeCheckKey = keyof FailedCompositeCheckKeyByName;

type FailedForeignCheckKeyByName = FailedCheckKeyByName & {
    readonly error: true;
    readonly label: true;
};

type FailedForeignCheckKey = keyof FailedForeignCheckKeyByName;

type SyncAssertionReturn = ReturnType<() => void>;

const syncAssertion = defineCompositeAssertion({
    assert(check, value: boolean) {
        return check.true(value);
    },
    name: 'syncAssertion'
});

const asyncAssertion = defineCompositeAssertion({
    async assert(check, value: boolean) {
        await Promise.resolve();
        return check.true(value);
    },
    name: 'asyncAssertion'
});

const narrowingAssertion = defineNarrowingCompositeAssertion({
    name: 'narrowingAssertion',
    narrows(value: unknown): value is string {
        return typeof value === 'string';
    }
});

declare const requireFacade: RequireAssertionFacade;
declare const assertFacade: AssertAssertionFacade;
declare const compositeCheckBuilder: CompositeCheckBuilder<'assert'>;
declare const functionValue: () => number;
declare const mixedDeepValue: string | { readonly id: string; };
declare const objectValues: readonly { readonly id: number; }[];
declare const unknownValue: unknown;
declare const unknownValues: readonly unknown[];

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
type RunResultKeys = readonly [
    'artifacts',
    'bySuite',
    'orphans',
    'perTest',
    'resourceUsage',
    'runnerErrors',
    'summary',
    'wallTimeMs'
];
type ExpectedRunResultKey = RunResultKeys[number];
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
    readonly rejects: true;
    readonly startsWith: true;
    readonly string: true;
    readonly throws: true;
    readonly true: true;
    readonly undefined: true;
};
type ExpectedTestScopeAssertContextKeys = ExpectedAssertFacadeKeys | 'collect';
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

    test('exposes structured failed check diagnostics', function () {
        expect<keyof FailedCheck>().type.toBe<keyof FailedCheckKeyByName>();
        expect<keyof FailedLeafCheck>().type.toBe<FailedLeafCheckKey>();
        expect<keyof FailedCompositeCheck>().type.toBe<FailedCompositeCheckKey>();
        expect<keyof FailedForeignCheck>().type.toBe<FailedForeignCheckKey>();
        expect<FailedCheck['actual']>().type.toBe<SerializedValue>();
        expect<FailedCheck['expected']>().type.toBe<SerializedValue>();
        expect<FailedCheck['diff']>().type.toBe<Diff | null>();
        expect<FailedCheck['path']>().type.toBe<readonly DiffPathSegment[]>();
    });

    test('exports serialized value and diff contracts', function () {
        expect<SerializedValue>().type.toBeAssignableFrom<{ readonly kind: 'number'; readonly value: '-0'; }>();
        expect<SerializedValue>().type.toBeAssignableFrom<{
            readonly kind: 'string';
            readonly truncation: SerializationTruncation | null;
            readonly value: 'value';
        }>();
        expect<DiffPathSegment>().type.toBeAssignableFrom<{
            readonly key: { readonly kind: 'string'; readonly value: 'name'; };
            readonly kind: 'property';
        }>();
        expect<DiffPathSegment>().type.toBeAssignableFrom<{
            readonly key: { readonly kind: 'number'; readonly value: 1; };
            readonly kind: 'map-value';
        }>();
        expect<Diff>().type.toBeAssignableFrom<{
            readonly actual: 'actual';
            readonly expected: 'expected';
            readonly hunks: readonly [];
            readonly kind: 'string';
        }>();
        expect<Diff>().type.toBeAssignableFrom<{
            readonly kind: 'binary';
            readonly actualHash: 'hash';
            readonly actualSize: 1;
            readonly expectedHash: 'hash';
            readonly expectedSize: 1;
            readonly ranges: readonly [];
        }>();
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

    test('exports source location helpers for raw assertion nodes', function () {
        expect<SourceLocation>().type.toBe<{
            readonly column: number | null;
            readonly file: string;
            readonly line: number | null;
        }>();
        expect<SourceLocationProvider>().type.toBe<() => SourceLocation>();
        expect<ResolvableSourceLocation>().type.toBe<SourceLocation | SourceLocationProvider>();
        expect<typeof captureSourceLocation>().type.toBe<() => SourceLocationProvider>();
        expect<typeof unknownSourceLocation>().type.toBeAssignableTo<SourceLocation>();
        expect<AssertAssertionNode>().type.toBeAssignableTo<{ readonly location: ResolvableSourceLocation; }>();
    });

    test('exposes the concept assert catalog without ok', function () {
        expect<keyof AssertAssertionFacade>().type.toBe<ExpectedAssertFacadeKeys>();
        expect<keyof AssertAssertionFacade>().type.not.toBeAssignableFrom<'collect'>();
    });

    test('keeps builder collection on the test scope assert context only', function () {
        expect<keyof TestScopeAssertContext>().type.toBe<ExpectedTestScopeAssertContextKeys>();
    });

    test('exposes the narrow require catalog without equality or collect', function () {
        expect<keyof RequireAssertionFacade>().type.toBe<ExpectedRequireFacadeKeys>();
    });

    test('uses explicit message options and facades on test scope', function () {
        expect<AssertionOptions>().type.toBe<{ readonly message: string; }>();
        expect<TestScope['assert']>().type.toBe<TestScopeAssertContext>();
        expect<TestScope['require']>().type.toBe<RequireAssertionFacade>();
    });

    test('defines explicit thrown matcher shapes', function () {
        expect<ExactThrownMatcher>().type.toBeAssignableFrom<{ readonly exact: 'raw'; }>();
        expect<ErrorMatcher>().type.toBeAssignableFrom<{
            readonly message: 'expected';
            readonly type: typeof Error;
        }>();
        expect<ThrownMatcher>().type.toBeAssignableFrom<{
            readonly cause: { readonly exact: 'raw'; };
            readonly message: RegExp;
        }>();
        expect<ErrorMatcher>().type.not.toBeAssignableFrom<{ readonly unused?: never; }>();
        expect<ThrownMatcher>().type.not.toBeAssignableFrom<{
            readonly exact: 'raw';
            readonly message: 'expected';
        }>();
    });

    test('accepts explicit throws and rejects assertions', function () {
        expect(assertFacade.throws).type.toBeCallableWith(function throwValue() {
            throw new Error('expected');
        }, { message: 'expected' });
        expect(assertFacade.throws).type.toBeCallableWith(function returnRawValue() {
            return 'raw';
        }, { exact: 'raw' });
        expect(assertFacade.rejects).type.toBeCallableWith(async function rejectValue() {
            await Promise.reject(new Error('expected'));
        }, { type: Error });
        expect(compositeCheckBuilder.throws).type.toBeCallableWith(function throwValue() {
            throw new Error('expected');
        }, { message: /expected/u });
        expect(compositeCheckBuilder.rejects).type.toBeCallableWith(async function rejectValue() {
            await Promise.reject(new Error('expected'));
        }, { exact: new Error('expected') });
    });

    test('rejects ambiguous thrown matcher calls', function () {
        expect(assertFacade.throws).type.not.toBeCallableWith(async function rejectValue() {
            await Promise.reject(new Error('expected'));
        }, { type: Error });
        expect(assertFacade.rejects).type.not.toBeCallableWith(function returnValue() {
            return undefined;
        }, { type: Error });
        expect(assertFacade.throws).type.not.toBeCallableWith(function throwValue() {
            throw new Error('expected');
        }, {});
        expect(assertFacade.throws).type.not.toBeCallableWith(function throwValue() {
            throw new Error('expected');
        }, { exact: 'raw', message: 'expected' });
    });

    test('infers callable custom assertion references', function () {
        const value: unknown = null;

        expect(syncAssertion).type.toBe<typeof syncAssertion>();
        expect<AssertReferenceArguments<typeof syncAssertion>>().type.toBe<readonly [value: boolean]>();
        expect<AssertReferenceReturn<typeof syncAssertion>>().type.toBe<SyncAssertionReturn>();
        expect<AssertReferenceReturn<typeof asyncAssertion>>().type.toBe<Promise<void>>();
        expect<AssertReferenceReturn<typeof narrowingAssertion>>().type.toBe<SyncAssertionReturn>();
        expect(asyncAssertion).type.toBe<typeof asyncAssertion>();
        requireFacade(narrowingAssertion, value);
        expect(value).type.toBe<string>();
    });
});

describe('Deep assertion operands', function () {
    test('defines deep comparable operands', function () {
        expect<DeepComparable>().type.toBe<unknown>();
        expect<DeepComparable<number>>().type.toBe<never>();
        expect<DeepComparable<string | { readonly id: string; }>>().type.toBe<never>();
        expect<DeepComparable<ReturnType<typeof JSON.parse>>>().type.toBe<never>();
    });

    test('accepts exact deep assertion operands', function () {
        expect(assertFacade.deepEqual).type.toBeCallableWith({ id: 1 }, { id: 1 });
        expect(assertFacade.deepEqual).type.toBeCallableWith([ 1 ], [ 1 ]);
        expect(assertFacade.deepEqual).type.toBeCallableWith(functionValue, functionValue);
        expect(assertFacade.deepEqual).type.toBeCallableWith(new Map<string, number>(), new Map<string, number>());
        expect(assertFacade.deepEqual).type.toBeCallableWith(new Set<number>(), new Set<number>());
        expect(assertFacade.deepEqual).type.toBeCallableWith(unknownValue, { id: 1 });
        expect(assertFacade.notDeepEqual).type.toBeCallableWith({ id: 1 }, { id: 2 });
    });

    test('accepts partial deep assertion operands', function () {
        expect(assertFacade.partialDeepEqual).type.toBeCallableWith({ id: 1, name: 'Ada' }, { id: 1 });
        expect(assertFacade.arrayContainsPartial).type.toBeCallableWith(objectValues, { id: 1 });
        expect(assertFacade.arrayContainsPartial).type.toBeCallableWith(unknownValues, { id: 1 });
        expect(assertFacade.membersPartialDeepEqual).type.toBeCallableWith(objectValues, [ { id: 1 } ]);
        expect(assertFacade.membersPartialDeepEqual).type.toBeCallableWith(unknownValues, unknownValues);
    });

    test('accepts composite builder deep assertion operands', function () {
        expect(compositeCheckBuilder.deepEqual).type.toBeCallableWith({ id: 1 }, { id: 1 });
        expect(compositeCheckBuilder.partialDeepEqual).type.toBeCallableWith({ id: 1 }, { id: 1 });
    });

    test('rejects exact primitive deep assertion operands', function () {
        expect(assertFacade.deepEqual).type.not.toBeCallableWith(1, 1);
        expect(assertFacade.notDeepEqual).type.not.toBeCallableWith('a', 'b');
        expect(assertFacade.deepEqual).type.not.toBeCallableWith(mixedDeepValue, { id: 'a' });
        expect(compositeCheckBuilder.deepEqual).type.not.toBeCallableWith(1, 1);
    });

    test('rejects partial primitive deep assertion operands', function () {
        expect(assertFacade.partialDeepEqual).type.not.toBeCallableWith(true, false);
        expect(assertFacade.arrayContainsPartial).type.not.toBeCallableWith([ 1 ], { id: 1 });
        expect(assertFacade.arrayContainsPartial).type.not.toBeCallableWith(objectValues, 1);
        expect(assertFacade.membersPartialDeepEqual).type.not.toBeCallableWith([ 1 ], [ { id: 1 } ]);
        expect(assertFacade.membersPartialDeepEqual).type.not.toBeCallableWith(objectValues, [ 1 ]);
        expect(compositeCheckBuilder.partialDeepEqual).type.not.toBeCallableWith(true, false);
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

describe('RunResult', function () {
    test('includes resource usage as nullable measured data', function () {
        expect<keyof RunResult>().type.toBe<ExpectedRunResultKey>();
        expect<RunResult['resourceUsage']>().type.toBe<RunResourceUsage | null>();
        expect<RunResourceUsage['start']>().type.toBe<ResourceUsageSnapshot>();
        expect<RunResourceUsageTracker['finish']>().type.toBe<() => RunResourceUsage>();
    });
});

describe('RunnerError', function () {
    test('subtype is the documented union', function () {
        expect<RunnerError['subtype']>().type.toBe<ExpectedRunnerErrorSubtype>();
    });
});

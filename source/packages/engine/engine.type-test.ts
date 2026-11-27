import { suite, test } from '@overkill-dev/test';
import { acceptsCall, assignableFrom, assignableTo, rejectsCall, sameType } from '@overkill-dev/type-test';
import {
    defineCompositeAssertion,
    defineNarrowingCompositeAssertion,
    type AssertReferenceArguments,
    type AssertReferenceReturn,
    type CompositeCheckBuilder
} from '../assert/assert.entry-point.ts';
import {
    CaseRunnerError,
    type isCaseRunnerError,
    type hasAttachedResourceDescriptors,
    type AssertAssertionFacade,
    type AssertAssertionNode,
    type AssertionNode,
    type AssertionResult,
    type AssertionSource,
    type CaseId,
    type CaseRunnerErrorOptions,
    type captureSourceLocation,
    type createThrowingTestCase,
    type DeepComparable,
    type Diff,
    type DiffPathSegment,
    type ErrorMatcher,
    type ExactThrownMatcher,
    type FailedCheck,
    type FailedCompositeCheck,
    type FailedForeignCheck,
    type FailedLeafCheck,
    type NonEmptyReadonlyArray,
    type PerTestResult,
    type ReporterEvent,
    type RequireAssertionFacade,
    type RequireAssertionNode,
    type ResolvableSourceLocation,
    type RunnerError,
    type SerializationTruncation,
    type SerializedValue,
    type SourceLocation,
    type SourceLocationProvider,
    type TestAnnotations,
    type WorkId,
    type TestAnnotationsInput,
    type TestControls,
    type TestControlsInput,
    type TestDebugScope,
    type TestFailure,
    type TestFamilyId,
    type TestBodyResourceAttachments,
    type TestOutcome,
    type ThrowingTestBody,
    type TestRandom,
    type ThrowingTestScope,
    type ThrownMatcher,
    type unknownSourceLocation
} from './engine.entry-point.ts';

type FailedCheckFixture = {
    readonly actual: { readonly kind: 'number'; readonly value: 1; };
    readonly diff: null;
    readonly expected: { readonly kind: 'undefined'; };
    readonly id: '1';
    readonly kind: 'leaf';
    readonly path: readonly [];
    readonly source: 'assert';
    readonly sourceLocations: readonly [
        { readonly column: null; readonly file: ''; readonly kind: 'known'; readonly line: null; }
    ];
    readonly summary: 'numbers differ';
};

type FailedCheckKeyByName = {
    readonly actual: true;
    readonly diff: true;
    readonly expected: true;
    readonly id: true;
    readonly kind: true;
    readonly path: true;
    readonly source: true;
    readonly sourceLocations: true;
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
declare const throwingBody: ThrowingTestBody;
declare const caseId: CaseId;
declare const workId: WorkId;
declare const mixedDeepValue: string | { readonly id: string; };
declare const objectValues: readonly { readonly id: number; }[];
declare const unknownValue: unknown;
declare const unknownValues: readonly unknown[];

type CaseIdFixture = {
    readonly file: null;
    readonly params: null;
    readonly suite: readonly ['suite'];
    readonly title: 'case';
};
type TestStartReporterEvent = Extract<ReporterEvent, { readonly kind: 'test-start'; }>;
type SuiteStartReporterEvent = Extract<ReporterEvent, { readonly kind: 'suite-start'; }>;

declare const createThrowingTestCaseUnderTest: typeof createThrowingTestCase;

export const testNode = suite('engine', [
    suite('TestOutcome', [
        test('exports resource descriptor attachment predicates', function (typeScope) {
            typeScope.assert(
                sameType<typeof hasAttachedResourceDescriptors, (attachments: TestBodyResourceAttachments) => boolean>()
            );
            return typeScope.assert.collect();
        }),
        test('exports case runner error markers', function (typeScope) {
            const error = new CaseRunnerError('Fixture failed.', {
                cause: unknownValue,
                subtype: 'fixture'
            });

            typeScope.assert(sameType<CaseRunnerErrorOptions, {
                readonly cause: unknown;
                readonly subtype: RunnerError['subtype'];
            }>());
            typeScope.assert(sameType.withActual<CaseRunnerError>(), error);
            typeScope.assert(sameType.withActual<RunnerError>(), error.runnerError(caseId, workId));
            typeScope.assert(sameType<typeof isCaseRunnerError, (value: unknown) => value is CaseRunnerError>());
            return typeScope.assert.collect();
        }),
        test('accepts public outcome shapes', function (typeScope) {
            typeScope.assert(assignableFrom<TestOutcome, { readonly kind: 'pass'; }>());
            typeScope.assert(assignableFrom<TestOutcome, {
                readonly failures: readonly [
                    {
                        readonly checks: readonly [FailedCheckFixture];
                        readonly kind: 'assertion';
                    }
                ];
                readonly kind: 'fail';
            }>());
            typeScope.assert(assignableFrom<TestOutcome, { readonly kind: 'skip'; readonly reason: 'filtered'; }>());
            typeScope.assert(assignableFrom<TestOutcome, {
                readonly kind: 'inconclusive';
                readonly reason: 'adapter lost result';
            }>());
            return typeScope.assert.collect();
        }),
        test('rejects mixed public outcome shapes', function (typeScope) {
            typeScope.assert(assignableFrom.not<TestOutcome, {
                readonly checks: readonly [];
                readonly kind: 'pass';
            }>());
            typeScope.assert(assignableFrom.not<TestOutcome, {
                readonly kind: 'pass';
                readonly reason: null;
            }>());
            typeScope.assert(assignableFrom.not<TestOutcome, {
                readonly checks: readonly [FailedCheckFixture];
                readonly kind: 'skip';
                readonly reason: 'filtered';
            }>());
            typeScope.assert(assignableFrom.not<TestOutcome, {
                readonly checks: readonly [FailedCheckFixture];
                readonly kind: 'inconclusive';
                readonly reason: 'adapter lost result';
            }>());
            typeScope.assert(assignableFrom.not<TestOutcome, { readonly kind: 'fail'; }>());
            typeScope.assert(assignableFrom.not<TestOutcome, {
                readonly checks: readonly [FailedCheckFixture];
                readonly kind: 'fail';
                readonly reason: null;
            }>());
            typeScope.assert(assignableFrom.not<TestOutcome, {
                readonly failures: readonly [];
                readonly kind: 'fail';
            }>());
            typeScope.assert(assignableFrom.not<TestOutcome, { readonly kind: 'skip'; }>());
            typeScope.assert(assignableFrom.not<TestOutcome, { readonly kind: 'inconclusive'; }>());
            return typeScope.assert.collect();
        }),
        test('exposes structured failed check diagnostics', function (typeScope) {
            typeScope.assert(sameType<keyof FailedCheck, keyof FailedCheckKeyByName>());
            typeScope.assert(sameType<keyof FailedLeafCheck, FailedLeafCheckKey>());
            typeScope.assert(sameType<keyof FailedCompositeCheck, FailedCompositeCheckKey>());
            typeScope.assert(sameType<keyof FailedForeignCheck, FailedForeignCheckKey>());
            typeScope.assert(sameType<FailedCheck['actual'], SerializedValue>());
            typeScope.assert(sameType<FailedCheck['expected'], SerializedValue>());
            typeScope.assert(sameType<FailedCheck['diff'], Diff | null>());
            typeScope.assert(sameType<FailedCheck['path'], readonly DiffPathSegment[]>());
            return typeScope.assert.collect();
        }),
        test('exports serialized value and diff contracts', function (typeScope) {
            typeScope.assert(assignableFrom<SerializedValue, { readonly kind: 'number'; readonly value: '-0'; }>());
            typeScope.assert(assignableFrom<SerializedValue, {
                readonly kind: 'string';
                readonly truncation: SerializationTruncation | null;
                readonly value: 'value';
            }>());
            typeScope.assert(assignableFrom<DiffPathSegment, {
                readonly key: { readonly kind: 'string'; readonly value: 'name'; };
                readonly kind: 'property';
            }>());
            typeScope.assert(assignableFrom<DiffPathSegment, {
                readonly key: { readonly kind: 'number'; readonly value: 1; };
                readonly kind: 'map-value';
            }>());
            typeScope.assert(assignableFrom<Diff, {
                readonly actual: 'actual';
                readonly expected: 'expected';
                readonly hunks: readonly [];
                readonly kind: 'string';
            }>());
            typeScope.assert(assignableFrom<Diff, {
                readonly kind: 'binary';
                readonly actualHash: 'hash';
                readonly actualSize: 1;
                readonly expectedHash: 'hash';
                readonly expectedSize: 1;
                readonly ranges: readonly [];
            }>());
            return typeScope.assert.collect();
        }),
        test('accepts public test failure shapes', function (typeScope) {
            typeScope.assert(assignableFrom<TestFailure, {
                readonly checks: readonly [FailedCheckFixture];
                readonly kind: 'assertion';
            }>());
            typeScope.assert(assignableFrom<TestFailure, {
                readonly error: {
                    readonly message: 'boom';
                    readonly name: 'Error';
                    readonly stack: null;
                    readonly thrown: unknown;
                };
                readonly kind: 'body-error';
            }>());
            typeScope.assert(assignableFrom<TestFailure, {
                readonly actual: 1;
                readonly code: 'plan-mismatch';
                readonly expected: '2';
                readonly kind: 'test-contract';
                readonly summary: 'Assertion plan count did not match.';
            }>());
            typeScope.assert(assignableFrom<TestFailure, {
                readonly error: {
                    readonly message: 'cleanup failed';
                    readonly name: 'Error';
                    readonly stack: null;
                    readonly thrown: unknown;
                };
                readonly kind: 'cleanup-error';
            }>());
            return typeScope.assert.collect();
        })
    ]),
    suite('Test Data', [
        test('exposes authored and resolved test data shapes', function (typeScope) {
            typeScope.assert(assignableFrom<TestAnnotationsInput, {
                readonly ownership: readonly ['@team'];
                readonly tags: readonly ['fast'];
            }>());
            typeScope.assert(assignableFrom<TestControlsInput, {
                readonly capture: 'buffered';
                readonly duplicateExecution: 'idempotent';
                readonly timeoutMilliseconds: number;
            }>());
            typeScope.assert(sameType<TestAnnotations, {
                readonly ownership: readonly string[];
                readonly tags: readonly string[];
            }>());
            typeScope.assert(sameType<TestControls, {
                readonly capture: 'buffered' | 'live' | null;
                readonly duplicateExecution: 'forbidden' | 'idempotent' | null;
                readonly timeoutMilliseconds: number | null;
            }>());
            typeScope.assert(sameType<TestFamilyId, string>());
            return typeScope.assert.collect();
        })
    ]),
    suite('Assertion protocol', [
        test('exports source-discriminated assertion nodes', function (typeScope) {
            typeScope.assert(sameType<AssertionSource, 'assert' | 'require'>());
            typeScope.assert(sameType<AssertionNode, AssertAssertionNode | RequireAssertionNode>());
            typeScope.assert(
                sameType<AssertionResult, AssertAssertionNode | NonEmptyReadonlyArray<AssertAssertionNode>>()
            );
            typeScope.assert(assignableFrom.not<AssertionResult, readonly []>());
            typeScope.assert(assignableFrom.not<AssertionResult, {
                readonly actual: 'value';
                readonly check: 'string';
                readonly message: null;
                readonly source: 'require';
            }>());
            return typeScope.assert.collect();
        }),
        test('exports source location helpers for raw assertion nodes', function (typeScope) {
            typeScope.assert(sameType<
                SourceLocation,
                {
                    readonly column: number | null;
                    readonly file: string;
                    readonly kind: 'known';
                    readonly line: number | null;
                } | {
                    readonly column?: never;
                    readonly file?: never;
                    readonly kind: 'unknown';
                    readonly line?: never;
                }
            >());
            typeScope.assert(sameType<SourceLocationProvider, () => SourceLocation>());
            typeScope.assert(sameType<ResolvableSourceLocation, SourceLocation | SourceLocationProvider>());
            typeScope.assert(sameType<typeof captureSourceLocation, () => SourceLocationProvider>());
            typeScope.assert(assignableTo<typeof unknownSourceLocation, SourceLocation>());
            typeScope.assert(assignableTo<AssertAssertionNode, {
                readonly sourceLocations: NonEmptyReadonlyArray<ResolvableSourceLocation>;
            }>());
            return typeScope.assert.collect();
        }),
        test('exposes first-class throwing test body types', function (typeScope) {
            typeScope.assert(sameType<ThrowingTestScope, {
                readonly debug: TestDebugScope;
                readonly seed: bigint;
                readonly random: TestRandom;
                readonly assert: AssertAssertionFacade;
                readonly require: RequireAssertionFacade;
                readonly signal: AbortSignal;
            }>());
            typeScope.assert(assignableFrom.not<keyof ThrowingTestScope, 'plan'>());
            typeScope.assert(assignableFrom.not<keyof ThrowingTestScope['assert'], 'collect'>());
            typeScope.assert(sameType<ThrowingTestBody, (scope: ThrowingTestScope) => Promise<void> | void>());
            typeScope.assert(acceptsCall, () =>
                createThrowingTestCaseUnderTest({
                    annotations: {},
                    body: throwingBody,
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    title: 'case'
                }));
            return typeScope.assert.collect();
        }),
        test('defines explicit thrown matcher shapes', function (typeScope) {
            typeScope.assert(assignableFrom<ExactThrownMatcher, { readonly exact: 'raw'; }>());
            typeScope.assert(assignableFrom<ErrorMatcher, {
                readonly message: 'expected';
                readonly type: typeof Error;
            }>());
            typeScope.assert(assignableFrom<ThrownMatcher, {
                readonly cause: { readonly exact: 'raw'; };
                readonly message: RegExp;
            }>());
            typeScope.assert(assignableFrom.not<ErrorMatcher, { readonly unused?: never; }>());
            typeScope.assert(assignableFrom.not<ThrownMatcher, {
                readonly exact: 'raw';
                readonly message: 'expected';
            }>());
            return typeScope.assert.collect();
        }),
        test('accepts explicit throws and rejects assertions', function (typeScope) {
            typeScope.assert(acceptsCall, () =>
                assertFacade.throws(function throwValue() {
                    throw new Error('expected');
                }, { message: 'expected' }));
            typeScope.assert(acceptsCall, () =>
                assertFacade.throws(function returnRawValue() {
                    return 'raw';
                }, { exact: 'raw' }));
            typeScope.assert(acceptsCall, () =>
                assertFacade.rejects(async function rejectValue() {
                    await Promise.reject(new Error('expected'));
                }, { type: Error, message: 'expected' }));
            typeScope.assert(acceptsCall, () =>
                compositeCheckBuilder.throws(function throwValue() {
                    throw new Error('expected');
                }, { message: /expected/u }));
            typeScope.assert(acceptsCall, () =>
                compositeCheckBuilder.rejects(async function rejectValue() {
                    await Promise.reject(new Error('expected'));
                }, { exact: new Error('expected') }));
            return typeScope.assert.collect();
        }),
        test('requires another matcher field for the base Error constructor', function (typeScope) {
            class RateLimitError extends Error {
                public constructor() {
                    super('Rate limit exceeded.');
                    this.name = 'RateLimitError';
                }
            }

            function throwRateLimit(): never {
                throw new RateLimitError();
            }

            async function rejectRateLimit(): Promise<never> {
                throw new RateLimitError();
            }

            typeScope.assert(acceptsCall, () => assertFacade.throws(throwRateLimit, { type: RateLimitError }));
            typeScope.assert(acceptsCall, () => assertFacade.rejects(rejectRateLimit, { type: TypeError }));
            typeScope.assert(rejectsCall('argument-type'), () => assertFacade.throws(throwRateLimit, { type: Error }));
            typeScope.assert(
                rejectsCall('argument-type'),
                () => assertFacade.rejects(rejectRateLimit, { type: Error })
            );
            typeScope.assert(
                rejectsCall('argument-type'),
                () => compositeCheckBuilder.throws(throwRateLimit, { type: Error })
            );
            typeScope.assert(
                rejectsCall('argument-type'),
                () => compositeCheckBuilder.rejects(rejectRateLimit, { cause: { type: Error } })
            );
            return typeScope.assert.collect();
        }),
        test('rejects ambiguous thrown matcher calls', function (typeScope) {
            async function rejectValue() {
                await Promise.reject(new Error('expected'));
            }
            typeScope.assert(
                rejectsCall('argument-type'),
                () => assertFacade.throws(rejectValue, { type: Error, message: 'expected' })
            );
            function returnValue() {
                return undefined;
            }
            typeScope.assert(
                rejectsCall('argument-type'),
                () => assertFacade.rejects(returnValue, { type: Error, message: 'expected' })
            );
            function throwValue() {
                throw new Error('expected');
            }
            typeScope.assert(rejectsCall('argument-type'), () => assertFacade.throws(throwValue, {}));
            typeScope.assert(
                rejectsCall('argument-type'),
                () => assertFacade.throws(throwValue, { exact: 'raw', message: 'expected' })
            );
            return typeScope.assert.collect();
        }),
        test('infers callable custom assertion references', function (typeScope) {
            const value: unknown = null;

            typeScope.assert(sameType.withActual<typeof syncAssertion>(), syncAssertion);
            typeScope.assert(sameType<AssertReferenceArguments<typeof syncAssertion>, readonly [value: boolean]>());
            typeScope.assert(sameType<AssertReferenceReturn<typeof syncAssertion>, SyncAssertionReturn>());
            typeScope.assert(sameType<AssertReferenceReturn<typeof asyncAssertion>, Promise<void>>());
            typeScope.assert(sameType<AssertReferenceReturn<typeof narrowingAssertion>, SyncAssertionReturn>());
            typeScope.assert(sameType.withActual<typeof asyncAssertion>(), asyncAssertion);
            requireFacade(narrowingAssertion, value);
            typeScope.assert(sameType.withActual<string>(), value);
            return typeScope.assert.collect();
        })
    ]),
    suite('Deep assertion operands', [
        test('defines deep comparable operands', function (typeScope) {
            typeScope.assert(sameType<DeepComparable, unknown>());
            typeScope.assert(sameType<DeepComparable<number>, never>());
            typeScope.assert(sameType<DeepComparable<string | { readonly id: string; }>, never>());
            typeScope.assert(sameType<DeepComparable<ReturnType<typeof JSON.parse>>, never>());
            return typeScope.assert.collect();
        }),
        test('accepts exact deep assertion operands', function (typeScope) {
            typeScope.assert(acceptsCall, () => assertFacade.deepEqual({ id: 1 }, { id: 1 }));
            typeScope.assert(acceptsCall, () => assertFacade.deepEqual([ 1 ], [ 1 ]));
            typeScope.assert(acceptsCall, () => assertFacade.deepEqual(functionValue, functionValue));
            typeScope.assert(
                acceptsCall,
                () => assertFacade.deepEqual(new Map<string, number>(), new Map<string, number>())
            );
            typeScope.assert(acceptsCall, () => assertFacade.deepEqual(new Set<number>(), new Set<number>()));
            typeScope.assert(acceptsCall, () => assertFacade.deepEqual(unknownValue, { id: 1 }));
            typeScope.assert(acceptsCall, () => assertFacade.notDeepEqual({ id: 1 }, { id: 2 }));
            return typeScope.assert.collect();
        }),
        test('accepts partial deep assertion operands', function (typeScope) {
            typeScope.assert(acceptsCall, () => assertFacade.partialDeepEqual({ id: 1, name: 'Ada' }, { id: 1 }));
            typeScope.assert(acceptsCall, () => assertFacade.arrayContainsPartial(objectValues, { id: 1 }));
            typeScope.assert(acceptsCall, () => assertFacade.arrayContainsPartial(unknownValues, { id: 1 }));
            typeScope.assert(acceptsCall, () => assertFacade.membersPartialDeepEqual(objectValues, [ { id: 1 } ]));
            typeScope.assert(acceptsCall, () => assertFacade.membersPartialDeepEqual(unknownValues, unknownValues));
            return typeScope.assert.collect();
        }),
        test('accepts composite builder deep assertion operands', function (typeScope) {
            typeScope.assert(acceptsCall, () => compositeCheckBuilder.deepEqual({ id: 1 }, { id: 1 }));
            typeScope.assert(acceptsCall, () => compositeCheckBuilder.partialDeepEqual({ id: 1 }, { id: 1 }));
            return typeScope.assert.collect();
        }),
        test('rejects exact primitive deep assertion operands', function (typeScope) {
            typeScope.assert(rejectsCall('argument-type'), () => assertFacade.deepEqual(1, 1));
            typeScope.assert(rejectsCall('argument-type'), () => assertFacade.notDeepEqual('a', 'b'));
            typeScope.assert(rejectsCall('argument-type'), () => assertFacade.deepEqual(mixedDeepValue, { id: 'a' }));
            typeScope.assert(rejectsCall('argument-type'), () => compositeCheckBuilder.deepEqual(1, 1));
            return typeScope.assert.collect();
        }),
        test('rejects partial primitive deep assertion operands', function (typeScope) {
            typeScope.assert(rejectsCall('argument-type'), () => assertFacade.partialDeepEqual(true, false));
            typeScope.assert(rejectsCall('argument-type'), () => assertFacade.arrayContainsPartial([ 1 ], { id: 1 }));
            typeScope.assert(rejectsCall('argument-type'), () => assertFacade.arrayContainsPartial(objectValues, 1));
            typeScope.assert(
                rejectsCall('argument-type'),
                () => assertFacade.membersPartialDeepEqual([ 1 ], [ { id: 1 } ])
            );
            typeScope.assert(
                rejectsCall('argument-type'),
                () => assertFacade.membersPartialDeepEqual(objectValues, [ 1 ])
            );
            typeScope.assert(rejectsCall('argument-type'), () => compositeCheckBuilder.partialDeepEqual(true, false));
            return typeScope.assert.collect();
        })
    ]),
    suite('CaseId', [
        test('accepts structured public identity shapes', function (typeScope) {
            typeScope.assert(assignableFrom<CaseId, CaseIdFixture>());
            typeScope.assert(sameType<PerTestResult['id'], CaseId>());
            typeScope.assert(sameType<TestStartReporterEvent['case'], CaseId>());
            typeScope.assert(sameType<
                SuiteStartReporterEvent['suitePath'],
                readonly {
                    readonly definitionLocations: NonEmptyReadonlyArray<ResolvableSourceLocation>;
                    readonly title: string;
                }[]
            >());
            typeScope.assert(sameType<RunnerError['attributedTo'], CaseId | null>());
            return typeScope.assert.collect();
        }),
        test('requires explicit nullable identity fields', function (typeScope) {
            typeScope.assert(assignableFrom.not<CaseId, {
                readonly suite: readonly ['suite'];
                readonly title: 'case';
            }>());
            typeScope.assert(assignableFrom.not<CaseId, {
                readonly file: null;
                readonly suite: readonly ['suite'];
                readonly title: 'case';
            }>());
            return typeScope.assert.collect();
        })
    ])
]);

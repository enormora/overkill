import type { IsEqual } from 'type-fest';
import { suite, test } from '../test/test.entry-point.ts';
import { acceptsCall, assignableFrom, rejectsCall, sameType } from '../type-test/type-test.entry-point.ts';
import {
    defineCompositeAssertion,
    defineNarrowingCompositeAssertion,
    type AssertReferenceArguments,
    type AssertReferenceReturn,
    type CompositeCheckBuilder
} from '../assert/assert.entry-point.ts';
import { type IsAssignable, isEqualTo } from '../../test-support/type-relations.ts';
import type {
    AssertAssertionFacade,
    AssertAssertionNode,
    AssertionNode,
    AssertionResult,
    AssertionSource,
    captureSourceLocation,
    createThrowingTestCase,
    DeepComparable,
    ErrorMatcher,
    ExactThrownMatcher,
    NonEmptyReadonlyArray,
    RequireAssertionFacade,
    RequireAssertionNode,
    ResolvableSourceLocation,
    SourceLocation,
    SourceLocationProvider,
    TestDebugScope,
    ThrowingTestBody,
    TestRandom,
    ThrowingTestScope,
    ThrownMatcher,
    unknownSourceLocation
} from './engine.entry-point.ts';

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
declare const mixedDeepValue: string | { readonly id: string; };
declare const objectValues: readonly { readonly id: number; }[];
declare const unknownValue: unknown;
declare const unknownValues: readonly unknown[];

declare const createThrowingTestCaseUnderTest: typeof createThrowingTestCase;

export const testNode = suite('Assertion operands and engine contracts', [
    suite('Assertion protocol', [
        test('exports source-discriminated assertion nodes', function (scope) {
            scope.assert(sameType<AssertionSource, 'assert' | 'require'>());
            scope.assert(sameType<IsEqual<AssertionNode, AssertAssertionNode | RequireAssertionNode>, true>());
            scope.assert(
                sameType<
                    IsEqual<AssertionResult, AssertAssertionNode | NonEmptyReadonlyArray<AssertAssertionNode>>,
                    true
                >()
            );
            scope.assert(sameType<IsAssignable<readonly [], AssertionResult>, false>());
            scope.assert(sameType<
                IsAssignable<{
                    readonly actual: 'value';
                    readonly check: 'string';
                    readonly message: null;
                    readonly source: 'require';
                }, AssertionResult>,
                false
            >());
            return scope.assert.collect();
        }),
        test('exports source location helpers for raw assertion nodes', function (scope) {
            scope.assert(sameType<
                IsEqual<
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
                >,
                true
            >());
            scope.assert(sameType<IsEqual<SourceLocationProvider, () => SourceLocation>, true>());
            scope.assert(
                sameType<IsEqual<ResolvableSourceLocation, SourceLocation | SourceLocationProvider>, true>()
            );
            scope.assert(sameType<IsEqual<typeof captureSourceLocation, () => SourceLocationProvider>, true>());
            scope.assert(sameType<IsAssignable<typeof unknownSourceLocation, SourceLocation>, true>());
            scope.assert(sameType<
                IsAssignable<AssertAssertionNode, {
                    readonly sourceLocations: NonEmptyReadonlyArray<ResolvableSourceLocation>;
                }>,
                true
            >());
            return scope.assert.collect();
        }),
        test('exposes first-class throwing test body types', function (scope) {
            scope.assert(sameType<
                IsEqual<ThrowingTestScope, {
                    readonly debug: TestDebugScope;
                    readonly seed: bigint;
                    readonly random: TestRandom;
                    readonly assert: AssertAssertionFacade;
                    readonly require: RequireAssertionFacade;
                    readonly signal: AbortSignal;
                }>,
                true
            >());
            scope.assert(assignableFrom.not<keyof ThrowingTestScope, 'plan'>());
            scope.assert(assignableFrom.not<keyof ThrowingTestScope['assert'], 'collect'>());
            scope.assert(
                sameType<IsEqual<ThrowingTestBody, (scope: ThrowingTestScope) => Promise<void> | void>, true>()
            );
            scope.assert(acceptsCall, function () {
                return createThrowingTestCaseUnderTest({
                    annotations: {},
                    body: throwingBody,
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    title: 'case'
                });
            });
            return scope.assert.collect();
        }),
        test('defines explicit thrown matcher shapes', function (scope) {
            scope.assert(sameType<IsAssignable<{ readonly exact: 'raw'; }, ExactThrownMatcher>, true>());
            scope.assert(sameType<
                IsAssignable<{
                    readonly message: 'expected';
                    readonly type: typeof Error;
                }, ErrorMatcher>,
                true
            >());
            scope.assert(sameType<
                IsAssignable<{
                    readonly cause: { readonly exact: 'raw'; };
                    readonly message: RegExp;
                }, ThrownMatcher>,
                true
            >());
            scope.assert(sameType<IsAssignable<{ readonly unused?: never; }, ErrorMatcher>, false>());
            scope.assert(sameType<
                IsAssignable<{
                    readonly exact: 'raw';
                    readonly message: 'expected';
                }, ThrownMatcher>,
                false
            >());
            return scope.assert.collect();
        }),
        test('accepts explicit throws and rejects assertions', function (scope) {
            scope.assert(acceptsCall, function () {
                assertFacade.throws(function throwValue() {
                    throw new Error('expected');
                }, { message: 'expected' });
            });
            scope.assert(acceptsCall, function () {
                assertFacade.throws(function returnRawValue() {
                    return 'raw';
                }, { exact: 'raw' });
            });
            scope.assert(acceptsCall, async function () {
                return assertFacade.rejects(async function rejectValue() {
                    await Promise.reject(new Error('expected'));
                }, { type: Error, message: 'expected' });
            });
            scope.assert(acceptsCall, function () {
                return compositeCheckBuilder.throws(function throwValue() {
                    throw new Error('expected');
                }, { message: /expected/u });
            });
            scope.assert(acceptsCall, async function () {
                return compositeCheckBuilder.rejects(async function rejectValue() {
                    await Promise.reject(new Error('expected'));
                }, { exact: new Error('expected') });
            });
            return scope.assert.collect();
        }),
        test('requires another matcher field for the base Error constructor', function (scope) {
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

            scope.assert(acceptsCall, function () {
                assertFacade.throws(throwRateLimit, { type: RateLimitError });
            });
            scope.assert(acceptsCall, async function () {
                return assertFacade.rejects(rejectRateLimit, { type: TypeError });
            });
            scope.assert(rejectsCall('argument-type'), function () {
                assertFacade.throws(throwRateLimit, { type: Error });
            });
            scope.assert(
                rejectsCall('argument-type'),
                async function () {
                    return assertFacade.rejects(rejectRateLimit, { type: Error });
                }
            );
            scope.assert(
                rejectsCall('argument-type'),
                function () {
                    return compositeCheckBuilder.throws(throwRateLimit, { type: Error });
                }
            );
            scope.assert(
                rejectsCall('argument-type'),
                async function () {
                    return compositeCheckBuilder.rejects(rejectRateLimit, { cause: { type: Error } });
                }
            );
            return scope.assert.collect();
        }),
        test('rejects ambiguous thrown matcher calls', function (scope) {
            async function rejectValue(): Promise<void> {
                await Promise.reject(new Error('expected'));
            }
            scope.assert(
                rejectsCall('argument-type'),
                function () {
                    assertFacade.throws(rejectValue, { type: Error, message: 'expected' });
                }
            );
            function returnValue(): undefined {
                return undefined;
            }
            scope.assert(
                rejectsCall('argument-type'),
                async function () {
                    return assertFacade.rejects(returnValue, { type: Error, message: 'expected' });
                }
            );
            function throwValue(): void {
                throw new Error('expected');
            }
            scope.assert(rejectsCall('argument-type'), function () {
                assertFacade.throws(throwValue, {});
            });
            scope.assert(
                rejectsCall('argument-type'),
                function () {
                    assertFacade.throws(throwValue, { exact: 'raw', message: 'expected' });
                }
            );
            return scope.assert.collect();
        }),
        test('infers callable custom assertion references', function (scope) {
            const value: unknown = null;

            scope.assert(sameType.withActual<true>(), isEqualTo<typeof syncAssertion>()(syncAssertion));
            scope.assert(
                sameType<IsEqual<AssertReferenceArguments<typeof syncAssertion>, readonly [value: boolean]>, true>()
            );
            scope.assert(
                sameType<IsEqual<AssertReferenceReturn<typeof syncAssertion>, SyncAssertionReturn>, true>()
            );
            scope.assert(sameType<IsEqual<AssertReferenceReturn<typeof asyncAssertion>, Promise<void>>, true>());
            scope.assert(
                sameType<IsEqual<AssertReferenceReturn<typeof narrowingAssertion>, SyncAssertionReturn>, true>()
            );
            scope.assert(sameType.withActual<true>(), isEqualTo<typeof asyncAssertion>()(asyncAssertion));
            requireFacade(narrowingAssertion, value);
            scope.assert(sameType.withActual<string>(), value);
            return scope.assert.collect();
        })
    ]),
    suite('Deep assertion operands', [
        test('defines deep comparable operands', function (scope) {
            scope.assert(sameType<DeepComparable, unknown>());
            scope.assert(sameType<DeepComparable<number>, never>());
            scope.assert(sameType<DeepComparable<string | { readonly id: string; }>, never>());
            scope.assert(sameType<DeepComparable<ReturnType<typeof JSON.parse>>, never>());
            return scope.assert.collect();
        }),
        test('accepts exact deep assertion operands', function (scope) {
            scope.assert(acceptsCall, function () {
                assertFacade.deepEqual({ id: 1 }, { id: 1 });
            });
            scope.assert(acceptsCall, function () {
                assertFacade.deepEqual([ 1 ], [ 1 ]);
            });
            scope.assert(acceptsCall, function () {
                assertFacade.deepEqual(functionValue, functionValue);
            });
            scope.assert(
                acceptsCall,
                function () {
                    assertFacade.deepEqual(new Map<string, number>(), new Map<string, number>());
                }
            );
            scope.assert(acceptsCall, function () {
                assertFacade.deepEqual(new Set<number>(), new Set<number>());
            });
            scope.assert(acceptsCall, function () {
                assertFacade.deepEqual(unknownValue, { id: 1 });
            });
            scope.assert(acceptsCall, function () {
                assertFacade.notDeepEqual({ id: 1 }, { id: 2 });
            });
            return scope.assert.collect();
        }),
        test('accepts partial deep assertion operands', function (scope) {
            scope.assert(acceptsCall, function () {
                assertFacade.partialDeepEqual({ id: 1, name: 'Ada' }, { id: 1 });
            });
            scope.assert(acceptsCall, function () {
                assertFacade.arrayContainsPartial(objectValues, { id: 1 });
            });
            scope.assert(acceptsCall, function () {
                assertFacade.arrayContainsPartial(unknownValues, { id: 1 });
            });
            scope.assert(acceptsCall, function () {
                assertFacade.membersPartialDeepEqual(objectValues, [ { id: 1 } ]);
            });
            scope.assert(acceptsCall, function () {
                assertFacade.membersPartialDeepEqual(unknownValues, unknownValues);
            });
            return scope.assert.collect();
        }),
        test('accepts composite builder deep assertion operands', function (scope) {
            scope.assert(acceptsCall, function () {
                return compositeCheckBuilder.deepEqual({ id: 1 }, { id: 1 });
            });
            scope.assert(acceptsCall, function () {
                return compositeCheckBuilder.partialDeepEqual({ id: 1 }, { id: 1 });
            });
            return scope.assert.collect();
        }),
        test('rejects exact primitive deep assertion operands', function (scope) {
            scope.assert(rejectsCall('argument-type'), function () {
                assertFacade.deepEqual(1, 1);
            });
            scope.assert(rejectsCall('argument-type'), function () {
                assertFacade.notDeepEqual('a', 'b');
            });
            scope.assert(rejectsCall('argument-type'), function () {
                assertFacade.deepEqual(mixedDeepValue, { id: 'a' });
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return compositeCheckBuilder.deepEqual(1, 1);
            });
            return scope.assert.collect();
        }),
        test('rejects partial primitive deep assertion operands', function (scope) {
            scope.assert(rejectsCall('argument-type'), function () {
                assertFacade.partialDeepEqual(true, false);
            });
            scope.assert(rejectsCall('argument-type'), function () {
                assertFacade.arrayContainsPartial([ 1 ], { id: 1 });
            });
            scope.assert(rejectsCall('argument-type'), function () {
                assertFacade.arrayContainsPartial(objectValues, 1);
            });
            scope.assert(
                rejectsCall('argument-type'),
                function () {
                    assertFacade.membersPartialDeepEqual([ 1 ], [ { id: 1 } ]);
                }
            );
            scope.assert(
                rejectsCall('argument-type'),
                function () {
                    assertFacade.membersPartialDeepEqual(objectValues, [ 1 ]);
                }
            );
            scope.assert(rejectsCall('argument-type'), function () {
                return compositeCheckBuilder.partialDeepEqual(true, false);
            });
            return scope.assert.collect();
        })
    ])
]);

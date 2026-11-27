import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import {
    acceptsCall,
    assignableFrom,
    assignableTo,
    rejectsCall,
    sameType
} from '../../../tools/type-tests/relations.entry-point.ts';
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

export const testNode = suite('engine', [
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
            typeScope.assert(acceptsCall, async () =>
                assertFacade.rejects(async function rejectValue() {
                    await Promise.reject(new Error('expected'));
                }, { type: Error, message: 'expected' }));
            typeScope.assert(acceptsCall, () =>
                compositeCheckBuilder.throws(function throwValue() {
                    throw new Error('expected');
                }, { message: /expected/u }));
            typeScope.assert(acceptsCall, async () =>
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
            typeScope.assert(acceptsCall, async () => assertFacade.rejects(rejectRateLimit, { type: TypeError }));
            typeScope.assert(rejectsCall('argument-type'), () => assertFacade.throws(throwRateLimit, { type: Error }));
            typeScope.assert(
                rejectsCall('argument-type'),
                async () => assertFacade.rejects(rejectRateLimit, { type: Error })
            );
            typeScope.assert(
                rejectsCall('argument-type'),
                () => compositeCheckBuilder.throws(throwRateLimit, { type: Error })
            );
            typeScope.assert(
                rejectsCall('argument-type'),
                async () => compositeCheckBuilder.rejects(rejectRateLimit, { cause: { type: Error } })
            );
            return typeScope.assert.collect();
        }),
        test('rejects ambiguous thrown matcher calls', function (typeScope) {
            async function rejectValue(): Promise<void> {
                await Promise.reject(new Error('expected'));
            }
            typeScope.assert(
                rejectsCall('argument-type'),
                () => assertFacade.throws(rejectValue, { type: Error, message: 'expected' })
            );
            function returnValue(): undefined {
                return undefined;
            }
            typeScope.assert(
                rejectsCall('argument-type'),
                async () => assertFacade.rejects(returnValue, { type: Error, message: 'expected' })
            );
            function throwValue(): void {
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
    ])
]);

import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, assignableFrom, rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type { IsAssignable } from '../../test-support/type-relations.ts';
import type {
    AssertAssertionFacade,
    AssertionOptions,
    InFlightTask,
    RequireAssertionFacade,
    TestScope,
    TestScopeAssertContext,
    TestRandom,
    ThrownMatcher
} from './engine.entry-point.ts';

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
type ExpectedTestScopeKeys = keyof {
    readonly debug: true;
    readonly seed: true;
    readonly random: true;
    readonly assert: true;
    readonly cleanup: true;
    readonly drainMicrotasks: true;
    readonly plan: true;
    readonly require: true;
    readonly settleAsyncWork: true;
    readonly signal: true;
    readonly startInFlight: true;
    readonly yieldToNextTurn: true;
};
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

declare const callUnderTest: InFlightTask<string>['rejects'];

export const testNode = suite('TestScope', [
    test('exposes case seeds and splittable randomness', function (typeScope) {
        typeScope.assert(sameType<TestScope['seed'], bigint>());
        typeScope.assert(sameType<IsEqual<TestScope['random'], TestRandom>, true>());
        typeScope.assert(sameType<IsEqual<TestRandom['split'], () => readonly [TestRandom, TestRandom]>, true>());
        return typeScope.assert.collect();
    }),
    test('exposes the concept assert catalog without ok', function (typeScope) {
        typeScope.assert(sameType<IsEqual<keyof AssertAssertionFacade, ExpectedAssertFacadeKeys>, true>());
        typeScope.assert(assignableFrom.not<keyof AssertAssertionFacade, 'collect'>());
        return typeScope.assert.collect();
    }),
    test('keeps builder collection on the test scope assert context only', function (typeScope) {
        typeScope.assert(sameType<IsEqual<keyof TestScopeAssertContext, ExpectedTestScopeAssertContextKeys>, true>());
        return typeScope.assert.collect();
    }),
    test('exposes the narrow require catalog without equality or collect', function (typeScope) {
        typeScope.assert(sameType<IsEqual<keyof RequireAssertionFacade, ExpectedRequireFacadeKeys>, true>());
        return typeScope.assert.collect();
    }),
    test('uses explicit message options and facades on test scope', function (typeScope) {
        typeScope.assert(sameType<IsEqual<AssertionOptions, { readonly message: string; }>, true>());
        typeScope.assert(sameType<IsEqual<keyof TestScope, ExpectedTestScopeKeys>, true>());
        typeScope.assert(sameType<IsEqual<TestScope['assert'], TestScopeAssertContext>, true>());
        typeScope.assert(
            sameType<IsEqual<TestScope['cleanup'], (callback: () => Promise<void> | void) => void>, true>()
        );
        typeScope.assert(sameType<IsEqual<TestScope['drainMicrotasks'], () => Promise<void>>, true>());
        typeScope.assert(sameType<IsEqual<TestScope['settleAsyncWork'], () => Promise<void>>, true>());
        typeScope.assert(
            sameType<
                IsEqual<
                    TestScope['startInFlight'],
                    <Value>(operation: () => PromiseLike<Value>) => InFlightTask<Value>
                >,
                true
            >()
        );
        typeScope.assert(sameType<IsEqual<TestScope['yieldToNextTurn'], () => Promise<void>>, true>());
        typeScope.assert(sameType<IsEqual<TestScope['require'], RequireAssertionFacade>, true>());
        return typeScope.assert.collect();
    }),
    test('types the in-flight task handle', function (typeScope) {
        typeScope.assert(sameType<IsEqual<InFlightTask<string>['wait'], () => Promise<string>>, true>());
        typeScope.assert(
            sameType<IsAssignable<InFlightTask<string>['rejects'], (matcher: ThrownMatcher) => Promise<void>>, true>()
        );
        typeScope.assert(acceptsCall, async () => callUnderTest({ type: Error, code: 'ECONNREFUSED' }));
        typeScope.assert(rejectsCall('argument-type'), async () => callUnderTest({ type: Error }));
        return typeScope.assert.collect();
    })
]);

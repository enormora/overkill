import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import {
    acceptsCall,
    assignableFrom,
    assignableTo,
    rejectsCall,
    sameType
} from '../../../tools/type-tests/relations.entry-point.ts';
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
        typeScope.assert(sameType<TestScope['random'], TestRandom>());
        typeScope.assert(sameType<TestRandom['split'], () => readonly [TestRandom, TestRandom]>());
        return typeScope.assert.collect();
    }),
    test('exposes the concept assert catalog without ok', function (typeScope) {
        typeScope.assert(sameType<keyof AssertAssertionFacade, ExpectedAssertFacadeKeys>());
        typeScope.assert(assignableFrom.not<keyof AssertAssertionFacade, 'collect'>());
        return typeScope.assert.collect();
    }),
    test('keeps builder collection on the test scope assert context only', function (typeScope) {
        typeScope.assert(sameType<keyof TestScopeAssertContext, ExpectedTestScopeAssertContextKeys>());
        return typeScope.assert.collect();
    }),
    test('exposes the narrow require catalog without equality or collect', function (typeScope) {
        typeScope.assert(sameType<keyof RequireAssertionFacade, ExpectedRequireFacadeKeys>());
        return typeScope.assert.collect();
    }),
    test('uses explicit message options and facades on test scope', function (typeScope) {
        typeScope.assert(sameType<AssertionOptions, { readonly message: string; }>());
        typeScope.assert(sameType<keyof TestScope, ExpectedTestScopeKeys>());
        typeScope.assert(sameType<TestScope['assert'], TestScopeAssertContext>());
        typeScope.assert(sameType<TestScope['cleanup'], (callback: () => Promise<void> | void) => void>());
        typeScope.assert(sameType<TestScope['drainMicrotasks'], () => Promise<void>>());
        typeScope.assert(sameType<TestScope['settleAsyncWork'], () => Promise<void>>());
        typeScope.assert(
            sameType<TestScope['startInFlight'], <Value>(operation: () => PromiseLike<Value>) => InFlightTask<Value>>()
        );
        typeScope.assert(sameType<TestScope['yieldToNextTurn'], () => Promise<void>>());
        typeScope.assert(sameType<TestScope['require'], RequireAssertionFacade>());
        return typeScope.assert.collect();
    }),
    test('types the in-flight task handle', function (typeScope) {
        typeScope.assert(sameType<InFlightTask<string>['wait'], () => Promise<string>>());
        typeScope.assert(assignableTo<InFlightTask<string>['rejects'], (matcher: ThrownMatcher) => Promise<void>>());
        typeScope.assert(acceptsCall, async () => callUnderTest({ type: Error, code: 'ECONNREFUSED' }));
        typeScope.assert(rejectsCall('argument-type'), async () => callUnderTest({ type: Error }));
        return typeScope.assert.collect();
    })
]);

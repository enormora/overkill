import { describe, expect, test } from 'tstyche';
import type {
    AssertAssertionFacade,
    AssertionOptions,
    InFlightTask,
    RequireAssertionFacade,
    TestScope,
    TestScopeAssertContext,
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

describe('TestScope', function () {
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
        expect<keyof TestScope>().type.toBe<ExpectedTestScopeKeys>();
        expect<TestScope['assert']>().type.toBe<TestScopeAssertContext>();
        expect<TestScope['cleanup']>().type.toBe<(callback: () => Promise<void> | void) => void>();
        expect<TestScope['drainMicrotasks']>().type.toBe<() => Promise<void>>();
        expect<TestScope['settleAsyncWork']>().type.toBe<() => Promise<void>>();
        expect<TestScope['startInFlight']>().type.toBe<
            <Value>(operation: () => PromiseLike<Value>) => InFlightTask<Value>
        >();
        expect<TestScope['yieldToNextTurn']>().type.toBe<() => Promise<void>>();
        expect<TestScope['require']>().type.toBe<RequireAssertionFacade>();
    });

    test('types the in-flight task handle', function () {
        expect<InFlightTask<string>['wait']>().type.toBe<() => Promise<string>>();
        expect<InFlightTask<string>['rejects']>().type.toBe<(matcher: ThrownMatcher) => Promise<void>>();
    });
});

import { test } from '@overkill-dev/test';
import { acceptsCall, rejectsCall } from '@overkill-dev/type-test';
import type { TestScope } from '../engine/engine.entry-point.ts';
import type { assignableFrom, assignableTo, sameType } from './type-test.entry-point.ts';

declare const testScope: TestScope;
declare const sameTypeUnderTest: typeof sameType;
declare const assignableToUnderTest: typeof assignableTo;
declare const assignableFromUnderTest: typeof assignableFrom;

export const testNode = test('relation references enforce assert-only operand tuples', function (scope) {
    scope.assert(acceptsCall, function () {
        testScope.assert(sameTypeUnderTest<string, number>());
    });
    scope.assert(rejectsCall('argument-count'), function () {
        testScope.require(sameTypeUnderTest<string, string>());
    });
    scope.assert(acceptsCall, function () {
        testScope.assert(assignableToUnderTest.withActual<string>(), 'value');
    });
    scope.assert(rejectsCall('argument-count'), async function () {
        return testScope.assert(assignableToUnderTest.withActual<string>());
    });
    scope.assert(acceptsCall, function () {
        testScope.assert(assignableFromUnderTest.not.withExpected<string>(), 'value');
    });
    scope.assert(acceptsCall, function () {
        testScope.assert(sameTypeUnderTest.not.expressions, true, false);
    });
    scope.assert(rejectsCall('argument-type'), async function () {
        return testScope.assert(sameTypeUnderTest.expressions, 1);
    });
    return scope.assert.collect();
});

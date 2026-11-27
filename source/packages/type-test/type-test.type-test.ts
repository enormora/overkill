import { test } from '@overkill-dev/test-type-authoring';
import { acceptsCall, rejectsCall } from '@overkill-dev/type-test';
import type { TestScope } from '../engine/engine.entry-point.ts';
import { sameType, assignableTo, assignableFrom } from './type-test.entry-point.ts';

declare const scope: TestScope;

export const testNode = test('relation references enforce assert-only operand tuples', function (typeScope) {
    typeScope.assert(acceptsCall, () => scope.assert(sameType<string, number>()));
    typeScope.assert(rejectsCall('argument-count'), () => scope.require(sameType<string, string>()));
    typeScope.assert(acceptsCall, () => scope.assert(assignableTo.withActual<string>(), 'value'));
    typeScope.assert(rejectsCall('argument-count'), async () => scope.assert(assignableTo.withActual<string>()));
    typeScope.assert(acceptsCall, () => scope.assert(assignableFrom.not.withExpected<string>(), 'value'));
    typeScope.assert(acceptsCall, () => scope.assert(sameType.not.expressions, true, false));
    typeScope.assert(rejectsCall('argument-type'), async () => scope.assert(sameType.expressions, 1));
    return typeScope.assert.collect();
});

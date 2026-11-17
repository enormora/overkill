import { expect, test } from 'tstyche';
import type { TestScope } from '../engine/engine.entry-point.ts';
import { sameType, assignableTo, assignableFrom } from './type-test.entry-point.ts';

declare const scope: TestScope;
test('relation references enforce assert-only operand tuples', function () {
    expect(scope.assert).type.toBeCallableWith(sameType<string, number>());
    expect(scope.require).type.not.toBeCallableWith(sameType<string, string>());
    expect(scope.assert).type.toBeCallableWith(assignableTo.withActual<string>(), 'value');
    expect(scope.assert).type.not.toBeCallableWith(assignableTo.withActual<string>());
    expect(scope.assert).type.toBeCallableWith(assignableFrom.not.withExpected<string>(), 'value');
    expect(scope.assert).type.toBeCallableWith(sameType.not.expressions, true, false);
    expect(scope.assert).type.not.toBeCallableWith(sameType.expressions, 1);
});

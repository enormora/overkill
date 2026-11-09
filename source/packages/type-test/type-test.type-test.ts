import type { Except } from 'type-fest';
import { expect, test } from 'tstyche';
import type { TestScope } from '../engine/engine.entry-point.ts';
import { checkTypeTests, type TypeTestCheckRequest } from './check.entry-point.ts';
import { sameType, callableWith, instantiableWith } from './type-test.entry-point.ts';

declare const scope: TestScope;

test('static references accept assertion recording but never require narrowing', function () {
    expect(scope.assert).type.toBeCallableWith(sameType<string, number>());
    expect(scope.require).type.not.toBeCallableWith(sameType<string, string>());
    expect(scope.assert).type.toBeCallableWith(sameType.withActual<string>(), 'value');
    expect(scope.assert).type.not.toBeCallableWith(sameType.withActual<string>());
    expect(scope.assert).type.toBeCallableWith(callableWith<(value: string) => void>(), 'value');
    expect(scope.assert).type.toBeCallableWith(instantiableWith<unknown, [string]>());
});

declare const request: TypeTestCheckRequest;
declare const incomplete: Except<TypeTestCheckRequest, 'order' | 'seed' | 'shard'>;
test('direct checking requires explicit runner planning', function () {
    expect(checkTypeTests).type.toBeCallableWith(request);
    expect(checkTypeTests).type.not.toBeCallableWith(incomplete);
});

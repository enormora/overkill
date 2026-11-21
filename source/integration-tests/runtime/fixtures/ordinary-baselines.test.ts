import { suite, test, skippedTest } from '@overkill-dev/test';

export const testNode = suite('ordinary observations', [
    test('first', (scope) => {
        scope.assert.false(scope.signal.aborted);
        return scope.assert.collect();
    }),
    test('second', (scope) => {
        scope.assert.false(scope.signal.aborted);
        return scope.assert.collect();
    }),
    skippedTest('unavailable', 'fixture unavailable')
]);

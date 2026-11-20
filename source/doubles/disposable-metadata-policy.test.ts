import { type TestNode, suite, test } from '@overkill-dev/test';
import { subjectAssertion } from '../test-support/assertion-reference-boundary.ts';
import { doubleUsage as subjectUsage } from '../packages/doubles/doubles.entry-point.ts';

import { testDisposable, testAsyncDisposable } from './protocol-double.ts';
import { protocolIteratorEvents, protocolDisposeMethod } from './protocol-double-metadata.ts';

export const testNode: TestNode = suite('disposable protocol metadata', [
    test('exposes empty iteration history for disposable protocol objects', function (scope) {
        scope.assert.deepEqual<unknown, unknown>(protocolIteratorEvents(testDisposable()), []);
        scope.assert.deepEqual<unknown, unknown>(protocolIteratorEvents(testAsyncDisposable()), []);
        return scope.assert.collect();
    }),
    test('shares asynchronous disposal history with usage assertions', async function (scope) {
        const disposable = testAsyncDisposable();
        scope.assert.equal(protocolDisposeMethod(disposable), disposable.asyncDispose);
        scope.assert(subjectAssertion(subjectUsage.notDisposed), disposable);
        await disposable.asyncDispose();
        scope.assert(subjectAssertion(subjectUsage.disposedOnce), disposable);
        scope.assert.equal(disposable.asyncDispose.callCount, 1);
        return scope.assert.collect();
    })
]);

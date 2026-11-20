import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { testDisposable, testAsyncDisposable } from './protocol-double.ts';
import { protocolIteratorEvents, protocolDisposeMethod } from './protocol-double-metadata.ts';
import { doubleUsage } from './double-usage.ts';

export const testNode = authoredSuite('disposable protocol metadata', [
    test('exposes empty iteration history for disposable protocol objects', function (scope: TestScope) {
        scope.assert.deepEqual<unknown, unknown>(protocolIteratorEvents(testDisposable()), []);
        scope.assert.deepEqual<unknown, unknown>(protocolIteratorEvents(testAsyncDisposable()), []);
        return scope.assert.collect();
    }),
    test('shares asynchronous disposal history with usage assertions', async function (scope: TestScope) {
        const disposable = testAsyncDisposable();
        scope.assert.equal(protocolDisposeMethod(disposable), disposable.asyncDispose);
        scope.assert(doubleUsage.notDisposed, disposable);
        await disposable.asyncDispose();
        scope.assert(doubleUsage.disposedOnce, disposable);
        scope.assert.equal(disposable.asyncDispose.callCount, 1);
        return scope.assert.collect();
    })
]);

import { type TestScope, suite, test } from '@overkill-dev/test';

import { createRoutedPool } from './worker-pool-routing.ts';

export const testNode = suite('empty routed pool observations', [
    test('rejects a usage summary without any routed process samples', async function (scope: TestScope) {
        const pool = createRoutedPool([]);
        const createTracker = pool.createProcessUsageTracker;
        scope.require.defined(createTracker);
        const tracker = createTracker({ samplingIntervalMilliseconds: 1 });
        scope.assert.throws(function () {
            tracker.finish();
        }, { message: 'Routed worker-pool process usage tracking requires at least one sample.' });
        scope.assert.equal(pool.options.maxThreads, 0);
        await pool.destroy();
        return scope.assert.collect();
    })
]);

import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { testNode as shutdown } from './worker-pool-shutdown-policy.test.ts';
import { createPool } from './worker-pool-creation.ts';

export const testNode = authoredSuite('idle fresh-worker pool policy', [
    shutdown,
    test('keeps fresh-worker pools idle until work is assigned', async function (scope: TestScope) {
        const pool = createPool({
            cwd: '/project',
            hostProcess: { kind: 'direct' },
            testFamily: 'integration',
            timing: null,
            workerCount: 1,
            workerLifecycle: 'fresh-worker-per-unit'
        });
        try {
            scope.assert.equal(pool.threads.length, 0);
            scope.assert.equal(pool.options.maxThreads, 1);
            scope.assert.true(pool.options.isolateWorkers);
        } finally {
            await pool.destroy();
        }
        return scope.assert.collect();
    })
]);

import { type TestScope, test, suite as authoredSuite } from '@overkill-dev/test';

import { idleWorkerRuntime, resourceOwnerRuntime } from '../test-support/idle-worker-runtime.ts';
import { testNode as acknowledgements } from './worker-resource-owner-policy.test.ts';

export const testNode = authoredSuite('idle worker runtime ownership', [
    acknowledgements,
    ...[ false, true ].map(function (timed) {
        return test(`isolates per-run resource ownership with timing ${timed}`, async function (scope: TestScope) {
            const runtime = await resourceOwnerRuntime(timed);
            scope.cleanup(runtime.pool.destroy);
            scope.assert.equal(runtime.pool.options.maxThreads, 2);
            scope.assert.equal(runtime.destroyPool, true);
            scope.assert.deepEqual(runtime.placementTraceEntries, []);
            return scope.assert.collect();
        });
    }),
    ...[ false, true ].map(function (timed) {
        return test(`creates an idle pool with timing ${timed}`, async function (scope: TestScope) {
            const runtime = await idleWorkerRuntime(timed);
            scope.cleanup(runtime.pool.destroy);
            scope.assert.equal(runtime.pool.options.maxThreads, 0);
            scope.assert.equal(runtime.destroyPool, true);
            scope.assert.deepEqual(runtime.placementTraceEntries, []);
            scope.assert.equal(runtime.poolProcessUsageTracker, null);
            return scope.assert.collect();
        });
    })
]);

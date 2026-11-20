import { type TestNode, table, suite } from '@overkill-dev/test';

import { idleWorkerRuntime, resourceOwnerRuntime } from '../test-support/idle-worker-runtime.ts';

export const testNode: TestNode = suite('idle worker runtime ownership', [
    table({
        title: 'isolates per-run resource ownership',
        cases: [ false, true ],
        caseTitle: String,
        async test(scope) {
            const timed = scope.parameters;

            const runtime = await resourceOwnerRuntime(timed);
            scope.cleanup(runtime.pool.destroy);
            scope.assert.equal(runtime.pool.options.maxThreads, 2);
            scope.assert.equal(runtime.destroyPool, true);
            scope.assert.deepEqual(runtime.placementTraceEntries, []);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'creates idle worker pools',
        cases: [ false, true ],
        caseTitle: String,
        async test(scope) {
            const timed = scope.parameters;

            const runtime = await idleWorkerRuntime(timed);
            scope.cleanup(runtime.pool.destroy);
            scope.assert.equal(runtime.pool.options.maxThreads, 0);
            scope.assert.equal(runtime.destroyPool, true);
            scope.assert.deepEqual(runtime.placementTraceEntries, []);
            scope.assert.equal(runtime.poolProcessUsageTracker, null);
            return scope.assert.collect();
        }
    })
]);

import { type TestScope as OverkillScope, suite, test } from '@overkill-dev/test';

import { workerLifecycleProbe } from '../test-support/worker-pool-lifecycle-probe.ts';
import type { WorkerLifecycle } from '../config/types.ts';
import type { TinypoolInstance } from './tinypool-node-compatibility.ts';
import { createTinypoolWorkerPool } from './worker-pool-creation.ts';

type WorkerLifecycleProbeResult = {
    readonly assignedUnits: number;
    readonly threadId: number;
};

const workerLifecycleProbeUrl = new URL('../test-support/worker-pool-lifecycle-probe.ts', import.meta.url);
const workerLifecycleProbeEntryPoint = workerLifecycleProbeUrl.href + workerLifecycleProbe.name.slice(0, 0);

function isWorkerLifecycleProbeResult(value: unknown): value is WorkerLifecycleProbeResult {
    return typeof value === 'object' &&
        value !== null &&
        typeof Reflect.get(value, 'assignedUnits') === 'number' &&
        typeof Reflect.get(value, 'threadId') === 'number';
}

async function runWorkerLifecycleProbe(pool: TinypoolInstance): Promise<WorkerLifecycleProbeResult> {
    const controller = new AbortController();
    const result = await pool.run(null, {
        name: 'workerLifecycleProbe',
        signal: controller.signal,
        transferList: []
    });

    if (!isWorkerLifecycleProbeResult(result)) {
        throw new Error('Worker lifecycle probe returned invalid output.');
    }

    return result;
}

function createLifecycleProbePool(workerLifecycle: WorkerLifecycle): TinypoolInstance {
    return createTinypoolWorkerPool({
        cwd: process.cwd(),
        filename: workerLifecycleProbeEntryPoint,
        hostProcess: { kind: 'direct' },
        testFamily: 'integration',
        workerCount: 1,
        workerLifecycle
    });
}

async function realTinypoolWorkerLifecycle(
    workerLifecycle: WorkerLifecycle
): Promise<readonly [WorkerLifecycleProbeResult, WorkerLifecycleProbeResult]> {
    const pool = createLifecycleProbePool(workerLifecycle);
    try {
        return [
            await runWorkerLifecycleProbe(pool),
            await runWorkerLifecycleProbe(pool)
        ];
    } finally {
        await pool.destroy();
    }
}

function assignedUnitCounts(results: readonly WorkerLifecycleProbeResult[]): readonly number[] {
    return results.map(function toAssignedUnits(result) {
        return result.assignedUnits;
    });
}

export const testNode = suite('source/run/worker-pool-lifecycle.test.ts', [
    test('fresh worker pools release workers between assignments', async function (scope: OverkillScope) {
        const pool = createLifecycleProbePool('fresh-worker-per-unit');
        try {
            await runWorkerLifecycleProbe(pool);
            scope.assert.equal(pool.threads.length, 0);
            return scope.assert.collect();
        } finally {
            await pool.destroy();
        }
    }),
    test('real Tinypool pools reuse or replace workers based on lifecycle', async function (scope: OverkillScope) {
        const reused = await realTinypoolWorkerLifecycle('reuse');
        const fresh = await realTinypoolWorkerLifecycle('fresh-worker-per-unit');

        scope.assert.equal(reused[0].threadId, reused[1].threadId);
        scope.assert.deepEqual(assignedUnitCounts(reused), [ 1, 2 ]);
        scope.assert.notEqual(fresh[0].threadId, fresh[1].threadId);
        scope.assert.deepEqual(assignedUnitCounts(fresh), [ 1, 1 ]);

        return scope.assert.collect();
    })
]);

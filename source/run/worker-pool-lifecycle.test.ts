import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { workerLifecycleProbe } from '../test-support/worker-pool-lifecycle-probe.ts';
import type { RunWorkerLifecycle } from './run-types.ts';
import type { TinypoolInstance } from './tinypool-node-compatibility.ts';
import { createTinypoolWorkerPool } from './worker-pool-runtime.ts';

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

async function realTinypoolWorkerLifecycle(
    workerLifecycle: RunWorkerLifecycle
): Promise<readonly [WorkerLifecycleProbeResult, WorkerLifecycleProbeResult]> {
    const pool = createTinypoolWorkerPool({
        filename: workerLifecycleProbeEntryPoint,
        workerCount: 1,
        workerLifecycle
    });

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

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-lifecycle.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'real Tinypool pools reuse or replace workers based on lifecycle',
            async body(scope: OverkillScope) {
                const reused = await realTinypoolWorkerLifecycle('reuse');
                const fresh = await realTinypoolWorkerLifecycle('fresh-worker-per-unit');

                scope.assert.equal(reused[0].threadId, reused[1].threadId);
                scope.assert.deepEqual(assignedUnitCounts(reused), [ 1, 2 ]);
                scope.assert.notEqual(fresh[0].threadId, fresh[1].threadId);
                scope.assert.deepEqual(assignedUnitCounts(fresh), [ 1, 1 ]);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

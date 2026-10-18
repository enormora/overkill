import { access, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
    benchmark, suite, wallClockMeasurement, workload,
    type BenchmarkMeasureContext, type BenchmarkMetrics, type WorkloadParameters
} from '../../../packages/bench/bench.entry-point.ts';
import { defineResource, withResource } from '../../../packages/test/resources.entry-point.ts';

const barrier = defineResource({
    name: 'placementBarrier', scope: 'per-run', requirements: [],
    async acquire() {
        await mkdir('target', { recursive: true });
        return await mkdtemp('target/benchmark-barrier-');
    },
    async dispose(directory) { await rm(directory, { recursive: true, force: true }); },
    serializeHandle(directory) { return directory; },
    deserializeHandle(directory: string) { return directory; }
});

async function waitForPeer(directory: string, name: string, signal: AbortSignal): Promise<void> {
    await writeFile(join(directory, name), 'ready');
    const peer = join(directory, name === 'left' ? 'right' : 'left');
    while (true) {
        try { await access(peer); return; }
        catch (error) {
            if (!(error instanceof Error) || Reflect.get(error, 'code') !== 'ENOENT') { throw error; }
        }
        await delay(5, undefined, { signal });
    }
}

function placementBenchmark(title: string, overlap: boolean, kind: 'bundle-size' | 'runtime') {
    return benchmark(title, {
        kind, workloads: [ workload('left', {}), workload('right', {}) ],
        measurement: wallClockMeasurement(),
        measure: withResource<typeof barrier, BenchmarkMeasureContext<WorkloadParameters>, Promise<BenchmarkMetrics>>(
            barrier,
            async (context) => {
                const measured = await context.sample.measure(async () => {
                    const directory = context.resources.placementBarrier;
                    if (overlap) {
                        await waitForPeer(directory, context.workload.name, context.signal);
                    } else {
                        const lock = join(directory, 'exclusive');
                        const handle = await open(lock, 'wx');
                        try { await delay(1, undefined, { signal: context.signal }); }
                        finally { await handle.close(); await rm(lock); }
                    }
                    return 100;
                });
                return { outputBytes: measured.value };
            }
        ),
        diagnosticMetrics: [],
        budgets: { left: { outputBytes: { maximum: 200 } }, right: { outputBytes: { maximum: 200 } } }
    });
}

export const testNode = suite('benchmark placement', [
    placementBenchmark('parallel sizes', true, 'bundle-size'),
    placementBenchmark('serial sizes', false, 'bundle-size'),
    placementBenchmark('sensitive work', false, 'runtime')
]);

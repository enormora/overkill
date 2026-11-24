// eslint-disable-next-line node/no-unsupported-features/node-builtins -- Node stabilized compile caching in v25.4.0.
import { flushCompileCache } from 'node:module';
import { loadTinypoolConstructor } from './tinypool-node-compatibility.ts';
import type { WorkerTask } from './worker-pool-protocol.ts';
import type { runTask as executeWorkerTask } from './worker-pool-worker.ts';

export const workerPoolEntryPointUrl = import.meta.url;

export async function runTask(task: WorkerTask): ReturnType<typeof executeWorkerTask> {
    const useCompileCache = task.kind === 'run' && loadTinypoolConstructor().workerData === true;
    try {
        const { runTask: execute } = await import('./worker-pool-worker.ts');
        return await execute(task);
    } finally {
        if (useCompileCache) {
            flushCompileCache();
        }
    }
}

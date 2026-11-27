// eslint-disable-next-line node/no-unsupported-features/node-builtins -- Node stabilized these APIs in v25.4.0.
import { enableCompileCache, flushCompileCache } from 'node:module';
import type { WorkerCompileCacheAccess } from './worker-compile-cache.ts';
import type { WorkerTask } from './worker-pool-protocol.ts';
import type { runTask as executeWorkerTask } from './worker-pool-worker.ts';

export const workerPoolEntryPointUrl = import.meta.url;

export async function runTask(task: WorkerTask): ReturnType<typeof executeWorkerTask> {
    const { runTask: execute } = await import('./worker-pool-worker.ts');
    return await execute(task);
}

type CachedWorkerTask = {
    readonly task: WorkerTask;
    readonly cache: WorkerCompileCacheAccess;
};

export async function runWithCompileCache(input: CachedWorkerTask): ReturnType<typeof executeWorkerTask> {
    const { task, cache } = input;
    const cacheOptions = { directory: cache.directory, readOnly: cache.mode === 'read-only' };
    enableCompileCache(cacheOptions);
    try {
        return await runTask(task);
    } finally {
        if (cache.mode === 'seed') {
            flushCompileCache();
        }
    }
}

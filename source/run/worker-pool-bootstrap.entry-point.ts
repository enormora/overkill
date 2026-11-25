import type { WorkerTask } from './worker-pool-protocol.ts';
import type { BootstrapModules } from './worker-bootstrap-modules.ts';
import type { runTask as executeWorkerTask } from './worker-pool-worker.ts';

export const workerPoolEntryPointUrl = import.meta.url;

export async function runTask(task: WorkerTask): ReturnType<typeof executeWorkerTask> {
    const { runTask: execute } = await import('./worker-pool-worker.ts');
    return await execute(task);
}

export async function runWithCachedBootstrap(task: WorkerTask, cache: BootstrapModules | null): Promise<{
    readonly result: Awaited<ReturnType<typeof executeWorkerTask>>;
    readonly modules: BootstrapModules | null;
}> {
    const { loadWorkerBootstrap } = await import('./worker-bootstrap-modules.ts');
    const { execute, modules } = await loadWorkerBootstrap(cache);
    return { result: await execute(task), modules };
}

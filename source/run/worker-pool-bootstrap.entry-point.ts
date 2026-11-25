import type { WorkerTask } from './worker-pool-protocol.ts';
import type { runTask as executeWorkerTask } from './worker-pool-worker.ts';

export const workerPoolEntryPointUrl = import.meta.url;

export async function runTask(task: WorkerTask): ReturnType<typeof executeWorkerTask> {
    const { runTask: execute } = await import('./worker-pool-worker.ts');
    return await execute(task);
}

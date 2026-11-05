import { loadTinypoolConstructor, type TinypoolInstance } from './tinypool-node-compatibility.ts';
import { workerPoolEntryPointUrl } from './worker-pool-worker.ts';
import type { WorkerPoolCreationOptions } from './run-orchestrator-dependencies.ts';

const Tinypool = loadTinypoolConstructor();
export const workerPoolEntryPoint = workerPoolEntryPointUrl;
type TinypoolWorkerPoolOptions = WorkerPoolCreationOptions & {
    readonly filename: string;
};

function isolateWorkers(options: TinypoolWorkerPoolOptions): boolean {
    return options.workerLifecycle === 'fresh-worker-per-unit';
}

type PoolRunOptions = Parameters<TinypoolInstance['run']>[1];
async function runWithCancellationTracking(
    pool: TinypoolInstance,
    task: unknown,
    options: PoolRunOptions,
    observeCancellation: () => void
): Promise<unknown> {
    options.signal.addEventListener('abort', observeCancellation, { once: true });
    try {
        return await pool.run(task, options);
    } finally {
        options.signal.removeEventListener('abort', observeCancellation);
    }
}
function awaitCancelledWorkers(pool: TinypoolInstance): TinypoolInstance {
    const workerExits: Promise<void>[] = [];
    const observeCancellation = function observeWorkerExit(): void {
        for (const worker of pool.threads) {
            workerExits.push(
                new Promise<void>(function awaitExit(resolve) {
                    worker.once('exit', resolve);
                })
            );
        }
    };
    return {
        get options() {
            return pool.options;
        },
        get threads() {
            return pool.threads;
        },
        async run(task, options) {
            return await runWithCancellationTracking(pool, task, options, observeCancellation);
        },
        async destroy() {
            await pool.destroy();
            await Promise.all(workerExits);
        }
    };
}

export function createTinypoolWorkerPool(options: TinypoolWorkerPoolOptions): TinypoolInstance {
    return awaitCancelledWorkers(
        new Tinypool({
            concurrentTasksPerWorker: 1,
            filename: options.filename,
            isolateWorkers: isolateWorkers(options),
            maxThreads: options.workerCount,
            minThreads: options.workerCount,
            runtime: 'worker_threads'
        })
    );
}

export function createPool(options: WorkerPoolCreationOptions): TinypoolInstance {
    return createTinypoolWorkerPool({
        ...options,
        filename: workerPoolEntryPoint
    });
}

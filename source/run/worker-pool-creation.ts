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

function awaitWorkerExits(pool: TinypoolInstance): TinypoolInstance {
    const observed = new WeakSet<TinypoolInstance['threads'][number]>();
    const exits: Promise<void>[] = [];
    const observeWorkers = function observeWorkerLifetimes(): void {
        const unobserved = pool.threads.filter(function unobservedWorker(worker) {
            return !observed.has(worker);
        });
        for (const worker of unobserved) {
            observed.add(worker);
            exits.push(
                new Promise<void>(function awaitExit(resolve) {
                    worker.once('exit', resolve);
                })
            );
        }
    };
    observeWorkers();
    return {
        get options() {
            return pool.options;
        },
        get threads() {
            return pool.threads;
        },
        async run(task, options) {
            observeWorkers();
            return await pool.run(task, options);
        },
        async destroy() {
            observeWorkers();
            await pool.destroy();
            await Promise.all(exits);
        }
    };
}

export function createTinypoolWorkerPool(options: TinypoolWorkerPoolOptions): TinypoolInstance {
    return awaitWorkerExits(
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

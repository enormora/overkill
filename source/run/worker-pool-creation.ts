import type { ResourceLimits } from 'node:worker_threads';
import { readProcessEnvironment } from './node-host-readers.ts';
import { loadTinypoolConstructor, type TinypoolInstance } from './tinypool-node-compatibility.ts';
import { workerPoolEntryPointUrl } from './worker-pool-bootstrap.entry-point.ts';
import {
    type WorkerCompileCache,
    createWorkerCompileCache,
    currentWorkerCompileCache
} from './worker-compile-cache.ts';
import type { WorkerPoolCreationOptions } from './run-orchestrator-dependencies.ts';

const Tinypool = loadTinypoolConstructor();
const freshWorkerYoungGenerationSizeMb = 8;
export const workerPoolEntryPoint = workerPoolEntryPointUrl;
type TinypoolWorkerPoolOptions = WorkerPoolCreationOptions & {
    readonly filename: string;
};

function isolateWorkers(options: TinypoolWorkerPoolOptions): boolean {
    return options.workerLifecycle === 'fresh-worker-per-unit';
}

export function observeWorkerPoolLifetime(pool: TinypoolInstance): TinypoolInstance {
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

function executionTaskKind(task: unknown): 'collect' | 'run' | null {
    if (typeof task !== 'object' || task === null) {
        return null;
    }
    const kind: unknown = Reflect.get(task, 'kind');
    return kind === 'collect' || kind === 'run' ? kind : null;
}

async function runCacheSeed(run: () => Promise<unknown>, cache: WorkerCompileCache): Promise<unknown> {
    try {
        const result = await run();
        cache.seedCompleted();
        return result;
    } catch (error) {
        cache.seedFailed();
        throw error;
    }
}

function withCompileCache(
    pool: TinypoolInstance,
    cache: WorkerCompileCache,
    owned: WorkerCompileCache | null
): TinypoolInstance {
    return {
        get options() {
            return pool.options;
        },
        get threads() {
            return pool.threads;
        },
        async run(task, options) {
            const kind = executionTaskKind(task);
            const access = kind === null ? null : await cache.claim(kind);
            if (access === null) {
                return await pool.run(task, options);
            }
            const execute = async function executeCachedTask(): Promise<unknown> {
                return await pool.run({ task, cache: access }, { ...options, name: 'runWithCompileCache' });
            };
            return await (access.mode === 'seed' ? runCacheSeed(execute, cache) : execute());
        },
        async destroy() {
            try {
                await pool.destroy();
            } finally {
                await owned?.dispose();
            }
        }
    };
}

function automaticCompileCache(options: TinypoolWorkerPoolOptions): boolean {
    const environment = readProcessEnvironment(process);
    const allowed = environment.NODE_COMPILE_CACHE === undefined && environment.NODE_DISABLE_COMPILE_CACHE !== '1' &&
        environment.NODE_V8_COVERAGE === undefined;
    return allowed && isolateWorkers(options) && options.filename === workerPoolEntryPoint && options.workerCount > 0;
}

function withOwnedCompileCache(pool: TinypoolInstance): TinypoolInstance {
    const cache = createWorkerCompileCache('run');
    return withCompileCache(pool, cache, cache);
}

function freshWorkerResourceLimits(cache: WorkerCompileCache | null): ResourceLimits {
    if (cache?.seedTask === 'collect') {
        return { maxYoungGenerationSizeMb: freshWorkerYoungGenerationSizeMb };
    }
    return {};
}

export function createTinypoolWorkerPool(options: TinypoolWorkerPoolOptions): TinypoolInstance {
    const useCompileCache = automaticCompileCache(options);
    const shared = useCompileCache ? currentWorkerCompileCache() : null;
    const pool = observeWorkerPoolLifetime(
        new Tinypool({
            concurrentTasksPerWorker: 1,
            filename: options.filename,
            isolateWorkers: isolateWorkers(options),
            maxThreads: options.workerCount,
            minThreads: isolateWorkers(options) ? 0 : options.workerCount,
            runtime: 'worker_threads',
            resourceLimits: freshWorkerResourceLimits(shared),
            useAtomics: false
        })
    );
    if (!useCompileCache) {
        return pool;
    }
    return shared === null
        ? withOwnedCompileCache(pool)
        : withCompileCache(pool, shared, null);
}

export function createPool(options: WorkerPoolCreationOptions): TinypoolInstance {
    return createTinypoolWorkerPool({
        ...options,
        filename: workerPoolEntryPoint
    });
}

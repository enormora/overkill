import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readProcessEnvironment } from './node-host-readers.ts';
import { loadTinypoolConstructor, type TinypoolInstance } from './tinypool-node-compatibility.ts';
import { workerPoolEntryPointUrl } from './worker-pool-bootstrap.entry-point.ts';
import type { BootstrapModules } from './worker-bootstrap-modules.ts';
import type { WorkerPoolCreationOptions } from './run-orchestrator-dependencies.ts';

const Tinypool = loadTinypoolConstructor();
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

function startTinypool(options: TinypoolWorkerPoolOptions, cacheEntryPoint: string | null): TinypoolInstance {
    return observeWorkerPoolLifetime(
        new Tinypool({
            concurrentTasksPerWorker: 1,
            filename: cacheEntryPoint ?? options.filename,
            isolateWorkers: isolateWorkers(options),
            maxThreads: options.workerCount,
            minThreads: isolateWorkers(options) ? 0 : options.workerCount,
            runtime: 'worker_threads',
            useAtomics: false
        })
    );
}

async function createCachedWorkerEntryPoint(lifetime: AsyncDisposableStack): Promise<string | null> {
    try {
        const directory = lifetime.use(await mkdtempDisposable(join(tmpdir(), 'overkill-worker-compile-cache-')));
        const entry = join(directory.path, 'worker.mjs');
        const bootstrap = [
            "import { enableCompileCache, flushCompileCache } from 'node:module';",
            'export async function runTask({ task, seedCache, snapshotModules, modules }) {',
            "    if (task.kind === 'run') {",
            '        const cacheOptions = { directory: import.meta.dirname };',
            '        if (!seedCache) {',
            '            cacheOptions.readOnly = true;',
            '        }',
            '        enableCompileCache(cacheOptions);',
            '    }',
            '    try {',
            `        const worker = await import(${JSON.stringify(workerPoolEntryPoint)});`,
            "        if (snapshotModules && task.kind === 'run') {",
            '            return await worker.runWithCachedBootstrap(task, modules);',
            '        }',
            '        return { result: await worker.runTask(task), modules: null };',
            '    } finally {',
            '        if (seedCache) {',
            '            flushCompileCache();',
            '        }',
            '    }',
            '}'
        ]
            .join('\n');
        await writeFile(entry, bootstrap);
        return entry;
    } catch {
        return null;
    }
}

function withoutPreloadHooks(): boolean {
    const { NODE_OPTIONS: nodeOptions } = readProcessEnvironment(process);
    const preload = process.execArgv.find(function preloads(argument) {
        return /^(?:--(?:import|require|(?:experimental-)?loader)(?:=|$)|-r)/u.test(argument);
    });
    return (nodeOptions === undefined || nodeOptions.trim() === '') && preload === undefined;
}

function isExecutionTask(task: unknown): boolean {
    return typeof task === 'object' && task !== null && Reflect.get(task, 'kind') === 'run';
}

function bootstrapModules(value: unknown): value is BootstrapModules {
    return typeof value === 'object' && value !== null && Reflect.get(value, 'resolutions') instanceof Map &&
        Reflect.get(value, 'sources') instanceof Map;
}

type CachedWorkerOutput = { readonly result: unknown; readonly modules: BootstrapModules | null; };

function cachedWorkerOutput(output: unknown): CachedWorkerOutput {
    if (typeof output !== 'object' || output === null) {
        throw new TypeError('Worker did not return its execution result.');
    }
    const result: unknown = Reflect.get(output, 'result');
    const modules: unknown = Reflect.get(output, 'modules');
    return { result, modules: bootstrapModules(modules) ? modules : null };
}

function withSeededCompileCache(pool: TinypoolInstance): TinypoolInstance {
    let cacheSeeded = false;
    let modules: BootstrapModules | null = null;
    const snapshotModules = withoutPreloadHooks();
    return {
        options: pool.options,
        get threads() {
            return pool.threads;
        },
        async run(task, options) {
            const seedCache = !cacheSeeded && isExecutionTask(task);
            const output = cachedWorkerOutput(await pool.run({ task, seedCache, snapshotModules, modules }, options));
            modules = modules ?? output.modules;
            cacheSeeded = cacheSeeded || seedCache;
            return output.result;
        },
        destroy: pool.destroy
    };
}

function createCachedFreshPool(options: TinypoolWorkerPoolOptions): TinypoolInstance {
    const lifetime = new AsyncDisposableStack();
    let started: Promise<TinypoolInstance> | null = null;
    let pool: TinypoolInstance | null = null;

    async function start(): Promise<TinypoolInstance> {
        const cacheEntryPoint = await createCachedWorkerEntryPoint(lifetime);
        const instance = startTinypool(options, cacheEntryPoint);
        lifetime.defer(instance.destroy);
        pool = instance;
        return cacheEntryPoint === null ? instance : withSeededCompileCache(instance);
    }

    return {
        options: { isolateWorkers: true, maxThreads: options.workerCount },
        get threads() {
            return pool?.threads ?? [];
        },
        async run(task, runOptions) {
            started = started ?? start();
            const instance = await started;
            return await instance.run(task, runOptions);
        },
        async destroy() {
            try {
                await started;
            } finally {
                await lifetime.disposeAsync();
            }
        }
    };
}

export function createTinypoolWorkerPool(options: TinypoolWorkerPoolOptions): TinypoolInstance {
    const environment = readProcessEnvironment(process);
    const canShareCompileCache = isolateWorkers(options) && options.filename === workerPoolEntryPoint &&
        options.workerCount > 0 && environment.NODE_DISABLE_COMPILE_CACHE !== '1' &&
        environment.NODE_V8_COVERAGE === undefined;
    return canShareCompileCache ? createCachedFreshPool(options) : startTinypool(options, null);
}

export function createPool(options: WorkerPoolCreationOptions): TinypoolInstance {
    return createTinypoolWorkerPool({
        ...options,
        filename: workerPoolEntryPoint
    });
}

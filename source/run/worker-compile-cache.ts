import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtempDisposable } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type WorkerCompileCacheAccess = {
    readonly directory: string;
    readonly mode: 'read-only' | 'seed';
};

type CacheTask = 'collect' | 'run';

export type WorkerCompileCache = {
    readonly dispose: () => Promise<void>;
    readonly seedTask: CacheTask;
    readonly claim: (task: CacheTask) => Promise<WorkerCompileCacheAccess | null>;
    readonly seedCompleted: () => void;
    readonly seedFailed: () => void;
};

async function createDirectory(lifetime: AsyncDisposableStack): Promise<string | null> {
    try {
        return lifetime.use(await mkdtempDisposable(join(tmpdir(), 'overkill-worker-compile-cache-'))).path;
    } catch {
        return null;
    }
}

export function createWorkerCompileCache(seedTask: CacheTask): WorkerCompileCache {
    const lifetime = new AsyncDisposableStack();
    let directory: Promise<string | null> | null = null;
    let status: 'empty' | 'ready' | 'seeding' = 'empty';

    function claimDirectory(path: string | null): WorkerCompileCacheAccess | null {
        if (path === null || status === 'seeding') {
            return null;
        }
        if (status === 'ready') {
            return { directory: path, mode: 'read-only' };
        }
        status = 'seeding';
        return { directory: path, mode: 'seed' };
    }

    return {
        seedTask,
        async claim(task) {
            if (task !== seedTask && task !== 'run') {
                return null;
            }
            directory = directory ?? createDirectory(lifetime);
            return claimDirectory(await directory);
        },
        seedCompleted() {
            status = 'ready';
        },
        seedFailed() {
            status = 'empty';
        },
        async dispose() {
            await directory;
            await lifetime.disposeAsync();
        }
    };
}

const runs = new AsyncLocalStorage<WorkerCompileCache>();

export function currentWorkerCompileCache(): WorkerCompileCache | null {
    return runs.getStore() ?? null;
}

export async function withWorkerCompileCache<Result>(seedTask: CacheTask, run: () => Promise<Result>): Promise<Result> {
    const cache = createWorkerCompileCache(seedTask);
    try {
        return await runs.run(cache, run);
    } finally {
        await cache.dispose();
    }
}

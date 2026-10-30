import { readdir, lstat, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { hostname } from 'node:os';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import type { HistoryStorage } from './history-storage-types.ts';
import { RunCollectionError } from './run-errors.ts';
import { createNodeHistoryStorage } from './node-history-storage.ts';
import type { HistoryOptions } from './history-types.ts';

function ownerAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error: unknown) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ESRCH') {
            return false;
        }
        throw error;
    }
}
async function assertOwnerInactive(
    store: HistoryStorage,
    ownerPath: string,
    options: HistoryOptions
): Promise<void> {
    const owner = z
        .object({ pid: z.number().int().positive(), host: z.string() })
        .parse(JSON.parse(await store.read(ownerPath) ?? 'null'));
    if (owner.host !== hostname()) {
        const live = await lockfile.check(ownerPath, {
            lockfilePath: `${ownerPath}.lease`,
            stale: options.config.history.staleLockMilliseconds
        });
        if (live) {
            throw new Error('History is owned by a run on another host.');
        }
        return;
    }
    if (ownerAlive(owner.pid)) {
        throw new Error('Persisted runs are active. Finish them before history maintenance.');
    }
}
async function existingStatus(target: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
    try {
        return await lstat(target);
    } catch (error: unknown) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
export type DetailedRecordState = 'available' | 'pruned' | 'unavailable';
export async function detailedRecordState(filePath: string): Promise<DetailedRecordState> {
    const status = await existingStatus(filePath);
    if (status === null) {
        return 'pruned';
    }
    return status.isFile() ? 'available' : 'unavailable';
}
async function assertNotLinked(target: string): Promise<void> {
    const status = await existingStatus(target);
    if (status?.isSymbolicLink() === true) {
        throw new Error(`History directory is a symbolic link: ${target}`);
    }
}

export async function historyDirectoryNames(directory: string): Promise<readonly string[]> {
    try {
        return await readdir(directory);
    } catch (error: unknown) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

type HistoryAccess = {
    readonly diagnostics: () => readonly string[];
    readonly directory: string;
    readonly policy: HistoryOptions['config']['history'];
    readonly store: HistoryStorage;
    readonly runs: string;
    readonly guarded: <T>(operation: () => Promise<T>) => Promise<T>;
    readonly removeAbandonedOwners: () => Promise<void>;
    readonly assertIdle: () => Promise<void>;
    readonly assertOwnedLocation: () => Promise<void>;
};
function containsProject(directory: string, projectRoot: string): boolean {
    const relative = path.relative(directory, projectRoot);
    return relative === '' ||
        relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function createHistoryAccess(options: HistoryOptions): HistoryAccess {
    const directory = path.resolve(options.projectRoot, options.config.runtimeStateDir);
    const policy = options.config.history;
    const store = createNodeHistoryStorage(directory, policy);
    const runs = path.join(directory, 'runs');
    const abandonedOwners = new Set<string>();
    async function guarded<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await store.withLock(operation);
        } catch (error: unknown) {
            if (error instanceof RunCollectionError) {
                throw error;
            }
            throw new RunCollectionError(
                `History operation failed: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error },
                'runtime-state'
            );
        }
    }
    async function assertIdle(): Promise<void> {
        abandonedOwners.clear();
        const listed = await historyDirectoryNames(path.join(directory, 'active-runs'));
        const names = listed.filter(function ownerMetadata(name) {
            return name.endsWith('.json');
        });
        for (const name of names) {
            await assertOwnerInactive(store, path.join(directory, 'active-runs', name), options);
            abandonedOwners.add(name);
        }
    }
    async function assertOwnedLocation(): Promise<void> {
        for (const name of [ 'runs', 'history', 'duration-history', 'active-runs' ]) {
            const target = path.join(directory, name);
            await assertNotLinked(target);
        }
        const resolved = await realpath(directory);
        if (resolved === path.parse(resolved).root || containsProject(resolved, await realpath(options.projectRoot))) {
            throw new Error('History state must have its own directory.');
        }
    }
    return {
        directory,
        policy,
        store,
        runs,
        guarded,
        assertIdle,
        async removeAbandonedOwners() {
            for (const name of abandonedOwners) {
                const ownerPath = path.join(directory, 'active-runs', name);
                await rm(`${ownerPath}.lease`, { recursive: true, force: true });
                await rm(ownerPath, { force: true });
            }
        },
        assertOwnedLocation,
        diagnostics() {
            return Array.from(abandonedOwners, function (name) {
                return `Abandoned run ownership: ${name}`;
            });
        }
    };
}

type HistoryOrder = { readonly startedAt: string; readonly id: string; };
export function assertHistoryRunId(id: string): void {
    if (id === '' || path.basename(id) !== id || id === '..' || id === '.') {
        throw new Error('Invalid history run identity.');
    }
}
export function compareHistoryRuns(left: HistoryOrder, right: HistoryOrder): number {
    const time = Date.parse(right.startedAt) - Date.parse(left.startedAt);
    return time === 0 ? left.id.localeCompare(right.id) : time;
}

import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { hostname } from 'node:os';
import lockfile from 'proper-lockfile';
import { createNodeFileStore, type FileStore } from '../file-store.ts';
import type { HistoryPolicy } from '../config/history-policy.ts';
import { checkHistoryMaintenanceBudget } from './history-maintenance-budget.ts';
import { acquireHistoryLock } from './history-lock-acquisition.ts';
import type { HistoryStorage } from './history-storage-types.ts';

type HistoryRunOwner = { readonly pid: number; readonly host: string; };
export type HistoryStorageRuntime = {
    readonly files: FileStore;
    readonly names: (target: string) => Promise<readonly string[]>;
    readonly prepare: (target: string) => Promise<void>;
    readonly remove: (target: string) => Promise<void>;
    readonly owner: () => HistoryRunOwner;
    readonly lease: (
        target: string,
        policy: HistoryPolicy,
        compromised: (error: Error) => void
    ) => Promise<() => Promise<void>>;
    readonly lock: typeof acquireHistoryLock;
};
type LockState = { readonly error: () => Error | null; readonly record: (error: Error) => void; };
function createLockState(): LockState {
    let error: Error | null = null;
    return {
        error() {
            return error;
        },
        record(value) {
            error = value;
        }
    };
}

async function directoryNames(directory: string): Promise<readonly string[]> {
    try {
        return await readdir(directory);
    } catch (error: unknown) {
        if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

async function historyFiles(directory: string, namesOf: HistoryStorageRuntime['names']): Promise<readonly string[]> {
    const names = await namesOf(directory);
    return names
        .filter(function jsonRecord(name) {
            return name.endsWith('.json');
        })
        .map(function recordPath(name) {
            return path.join(directory, name);
        });
}

async function guardedHistoryOperation<T>(operation: () => Promise<T>, state: LockState): Promise<T> {
    const result = await operation();
    const error = state.error();
    if (error !== null) {
        throw error;
    }
    return result;
}

async function acquireRunLease(
    ownerPath: string,
    policy: HistoryPolicy,
    state: LockState,
    runtime: HistoryStorageRuntime
): Promise<() => Promise<void>> {
    try {
        return await runtime.lease(ownerPath, policy, state.record);
    } catch (error: unknown) {
        await runtime.remove(ownerPath);
        throw error;
    }
}
export function createHistoryStorage(
    directory: string,
    policy: HistoryPolicy,
    runtime: HistoryStorageRuntime
): HistoryStorage {
    const store = runtime.files;
    const history: HistoryStorage = {
        async beginRun(id) {
            const ownerPath = path.join(directory, 'active-runs', `${id}.json`);
            const state = createLockState();
            const release = await history.withLock(async function registerOwner() {
                await store.create(ownerPath, JSON.stringify(runtime.owner()));
                return await acquireRunLease(ownerPath, policy, state, runtime);
            });
            return async function releaseOwner() {
                await release();
                await runtime.remove(ownerPath);
                const error = state.error();
                if (error !== null) {
                    throw error;
                }
            };
        },
        async read(target) {
            checkHistoryMaintenanceBudget();
            return await store.read(target);
        },
        async write(target, content) {
            checkHistoryMaintenanceBudget();
            await store.write(target, content);
        },
        async list(target) {
            checkHistoryMaintenanceBudget();
            return await historyFiles(target, runtime.names);
        },
        async withLock(operation) {
            checkHistoryMaintenanceBudget();
            await runtime.prepare(directory);
            const state = createLockState();
            const release = await runtime.lock(directory, policy, state.record);
            try {
                return await guardedHistoryOperation(operation, state);
            } finally {
                await release();
            }
        }
    };
    return history;
}

export function createNodeHistoryStorage(directory: string, policy: HistoryPolicy): HistoryStorage {
    return createHistoryStorage(directory, policy, {
        files: createNodeFileStore(),
        names: directoryNames,
        async prepare(target) {
            await mkdir(target, { recursive: true });
        },
        async remove(target) {
            await rm(target, { force: true });
        },
        owner() {
            return { pid: process.pid, host: hostname() };
        },
        async lease(target, leasePolicy, compromised) {
            return await lockfile.lock(target, {
                lockfilePath: `${target}.lease`,
                stale: leasePolicy.staleLockMilliseconds,
                onCompromised: compromised
            });
        },
        lock: acquireHistoryLock
    });
}

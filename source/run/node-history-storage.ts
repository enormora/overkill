import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { hostname } from 'node:os';
import lockfile from 'proper-lockfile';
import { createNodeFileStore } from '../file-store.ts';
import type { HistoryPolicy } from '../config/history-policy.ts';
import { checkHistoryMaintenanceBudget } from './history-maintenance-budget.ts';
import { acquireHistoryLock } from './history-lock-acquisition.ts';
import type { HistoryStorage } from './history-storage-types.ts';

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

async function historyFiles(directory: string): Promise<readonly string[]> {
    const names = await directoryNames(directory);
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
    state: LockState
): Promise<() => Promise<void>> {
    try {
        return await lockfile.lock(ownerPath, {
            lockfilePath: `${ownerPath}.lease`,
            stale: policy.staleLockMilliseconds,
            onCompromised: state.record
        });
    } catch (error: unknown) {
        await rm(ownerPath, { force: true });
        throw error;
    }
}
export function createNodeHistoryStorage(directory: string, policy: HistoryPolicy): HistoryStorage {
    const store = createNodeFileStore();
    const history: HistoryStorage = {
        async beginRun(id) {
            const ownerPath = path.join(directory, 'active-runs', `${id}.json`);
            const state = createLockState();
            const release = await history.withLock(async function registerOwner() {
                await store.create(ownerPath, JSON.stringify({ pid: process.pid, host: hostname() }));
                return await acquireRunLease(ownerPath, policy, state);
            });
            return async function releaseOwner() {
                await release();
                await rm(ownerPath, { force: true });
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
            return await historyFiles(target);
        },
        async withLock(operation) {
            checkHistoryMaintenanceBudget();
            await mkdir(directory, { recursive: true });
            const state = createLockState();
            const release = await acquireHistoryLock(directory, policy, state.record);
            try {
                return await guardedHistoryOperation(operation, state);
            } finally {
                await release();
            }
        }
    };
    return history;
}

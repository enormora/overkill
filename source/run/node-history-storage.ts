import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createNodeFileStore } from '../file-store.ts';
import type { HistoryPolicy } from '../config/history-policy.ts';
import type { HistoryStorage } from './history-storage-types.ts';

const retryIntervalMilliseconds = 25;
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

async function acquireHistoryLock(
    directory: string,
    policy: HistoryPolicy,
    state: LockState
): Promise<() => Promise<void>> {
    const { default: lockfile } = await import('proper-lockfile');
    const options = {
        lockfilePath: path.join(directory, 'history.lock'),
        stale: policy.staleLockMilliseconds,
        onCompromised(error: Error) {
            state.record(error);
        }
    };
    const deadline = performance.now() + policy.lockTimeoutMilliseconds;
    for (;;) {
        try {
            return await lockfile.lock(directory, options);
        } catch (error: unknown) {
            if (performance.now() >= deadline || !await lockfile.check(directory, options)) {
                throw error;
            }
            await delay(Math.min(retryIntervalMilliseconds, Math.max(0, deadline - performance.now())));
        }
    }
}

async function guardedHistoryOperation<T>(operation: () => Promise<T>, state: LockState): Promise<T> {
    const result = await operation();
    const error = state.error();
    if (error !== null) {
        throw error;
    }
    return result;
}

export function createNodeHistoryStorage(directory: string, policy: HistoryPolicy): HistoryStorage {
    const store = createNodeFileStore();
    return {
        read: store.read,
        write: store.write,
        list: historyFiles,
        async withLock(operation) {
            await mkdir(directory, { recursive: true });
            const state = createLockState();
            const release = await acquireHistoryLock(directory, policy, state);
            try {
                return await guardedHistoryOperation(operation, state);
            } finally {
                await release();
            }
        }
    };
}

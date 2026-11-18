import { readFile, readdir, lstat, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { hostname } from 'node:os';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import { historyRecordSchema } from './history-record.ts';
import {
    checkHistoryMaintenanceBudget,
    historyMaintenanceDiagnostics,
    historyMaintenanceDeadline,
    HistoryMaintenanceDeferredError
} from './history-maintenance-budget.ts';
import type { HistoryStorageFactory, HistoryStorage } from './history-storage-types.ts';
import { RunCollectionError } from './run-errors.ts';

import type { HistoryOptions } from './history-types.ts';

function rejectActiveOwner(message: string): never {
    if (Number.isFinite(historyMaintenanceDeadline())) {
        throw new HistoryMaintenanceDeferredError();
    }
    throw new Error(message);
}

async function assertOwnerInactive(
    store: HistoryStorage,
    ownerPath: string,
    options: HistoryOptions,
    runtime: HistoryAccessRuntime
): Promise<void> {
    const owner = z
        .object({ pid: z.number().int().positive(), host: z.string() })
        .parse(JSON.parse(await store.read(ownerPath) ?? 'null'));
    if (owner.host !== runtime.host()) {
        const live = await runtime.lease(ownerPath, options.config.history.staleLockMilliseconds);
        if (live) {
            rejectActiveOwner('History is owned by a run on another host.');
        }
        return;
    }
    if (runtime.alive(owner.pid)) {
        rejectActiveOwner('Persisted runs are active. Finish them before history maintenance.');
    }
}
export type DetailedRecordState = 'available' | 'pruned' | 'unavailable';
export type HistoryAccessRuntime = {
    readonly metadata: (target: string) => Promise<'file' | 'other' | 'symbolic-link' | null>;
    readonly readText: (target: string) => Promise<string>;
    readonly names: (directory: string) => Promise<readonly string[]>;
    readonly canonical: (target: string) => Promise<string>;
    readonly remove: (target: string, recursive: boolean) => Promise<void>;
    readonly host: () => string;
    readonly alive: (pid: number) => boolean;
    readonly lease: (target: string, staleMilliseconds: number) => Promise<boolean>;
};
function recordCompatibility(content: string): DetailedRecordState {
    const decoded = historyRecordSchema.safeParse(JSON.parse(content));
    if (!decoded.success) {
        return 'unavailable';
    }
    const record = decoded.data;
    return record.replayPlan !== null && record.replayProfile !== null && record.facts !== null
        ? 'available'
        : 'unavailable';
}

async function compatibleRecordState(filePath: string, runtime: HistoryAccessRuntime): Promise<DetailedRecordState> {
    try {
        return recordCompatibility(await runtime.readText(filePath));
    } catch {
        return 'unavailable';
    }
}

export async function inspectDetailedRecordState(
    filePath: string,
    runtime: HistoryAccessRuntime
): Promise<DetailedRecordState> {
    const status = await runtime.metadata(filePath);
    if (status === null) {
        return 'pruned';
    }
    return status === 'file' ? await compatibleRecordState(filePath, runtime) : 'unavailable';
}
async function assertNotLinked(target: string, runtime: HistoryAccessRuntime): Promise<void> {
    const status = await runtime.metadata(target);
    if (status === 'symbolic-link') {
        throw new Error(`History directory is a symbolic link: ${target}`);
    }
}

export type HistoryAccess = {
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
export function openHistoryAccess(
    options: HistoryOptions,
    createStorage: HistoryStorageFactory,
    runtime: HistoryAccessRuntime
): HistoryAccess {
    const directory = path.resolve(options.projectRoot, options.config.runtimeStateDir);
    const policy = options.config.history;
    const store = createStorage(directory, policy);
    const runs = path.join(directory, 'runs');
    const abandonedOwners = new Set<string>();
    async function guarded<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await store.withLock(operation);
        } catch (error: unknown) {
            if (error instanceof RunCollectionError || error instanceof HistoryMaintenanceDeferredError) {
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
        const listed = await runtime.names(path.join(directory, 'active-runs'));
        const names = listed.filter(function ownerMetadata(name) {
            return name.endsWith('.json');
        });
        for (const name of names) {
            checkHistoryMaintenanceBudget();
            await assertOwnerInactive(store, path.join(directory, 'active-runs', name), options, runtime);
            abandonedOwners.add(name);
        }
    }
    async function assertOwnedLocation(): Promise<void> {
        for (const name of [ 'runs', 'history', 'duration-history', 'active-runs' ]) {
            const target = path.join(directory, name);
            await assertNotLinked(target, runtime);
        }
        const resolved = await runtime.canonical(directory);
        if (
            resolved === path.parse(resolved).root ||
            containsProject(resolved, await runtime.canonical(options.projectRoot))
        ) {
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
                checkHistoryMaintenanceBudget();
                const ownerPath = path.join(directory, 'active-runs', name);
                await runtime.remove(`${ownerPath}.lease`, true);
                await runtime.remove(ownerPath, false);
            }
        },
        assertOwnedLocation,
        diagnostics() {
            return [
                ...historyMaintenanceDiagnostics(),
                ...Array.from(abandonedOwners, function (name) {
                    return `Abandoned run ownership: ${name}`;
                })
            ];
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

type HistoryFileStatus = { readonly isSymbolicLink: () => boolean; readonly isFile: () => boolean; };
type HistoryRemovalOptions = { readonly recursive: boolean; readonly force: true; };
type HistoryLeaseOptions = { readonly lockfilePath: string; readonly stale: number; };
export type HistoryAccessSystem = {
    readonly status: (target: string) => Promise<HistoryFileStatus>;
    readonly read: (target: string, encoding: 'utf8') => Promise<string>;
    readonly names: (directory: string) => Promise<readonly string[]>;
    readonly canonical: HistoryAccessRuntime['canonical'];
    readonly remove: (target: string, options: HistoryRemovalOptions) => Promise<void>;
    readonly host: HistoryAccessRuntime['host'];
    readonly probe: (pid: number, signal: 0) => unknown;
    readonly lease: (target: string, options: HistoryLeaseOptions) => Promise<boolean>;
};
export function createHistoryAccessRuntime(system: HistoryAccessSystem): HistoryAccessRuntime {
    function ownerAlive(pid: number): boolean {
        try {
            system.probe(pid, 0);
            return true;
        } catch (error: unknown) {
            if (error instanceof Error && Reflect.get(error, 'code') === 'ESRCH') {
                return false;
            }
            throw error;
        }
    }
    async function existingStatus(target: string): Promise<HistoryFileStatus | null> {
        checkHistoryMaintenanceBudget();
        try {
            return await system.status(target);
        } catch (error: unknown) {
            if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }
    async function historyDirectoryNames(directory: string): Promise<readonly string[]> {
        checkHistoryMaintenanceBudget();
        try {
            return await system.names(directory);
        } catch (error: unknown) {
            if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    return {
        async metadata(target) {
            const status = await existingStatus(target);
            if (status === null) {
                return null;
            }
            if (status.isSymbolicLink()) {
                return 'symbolic-link';
            }
            return status.isFile() ? 'file' : 'other';
        },
        async readText(target) {
            return await system.read(target, 'utf8');
        },
        names: historyDirectoryNames,
        canonical: system.canonical,
        async remove(target, recursive) {
            await system.remove(target, { recursive, force: true });
        },
        host: system.host,
        alive: ownerAlive,
        async lease(target, staleMilliseconds) {
            return await system.lease(target, { lockfilePath: `${target}.lease`, stale: staleMilliseconds });
        }
    };
}
const nativeHistoryAccess = createHistoryAccessRuntime({
    status: lstat,
    read: readFile,
    names: readdir,
    canonical: realpath,
    remove: rm,
    host: hostname,
    probe: process.kill.bind(process),
    lease: lockfile.check
});
export const historyDirectoryNames = nativeHistoryAccess.names;
export function createHistoryAccess(options: HistoryOptions, createStorage: HistoryStorageFactory): HistoryAccess {
    return openHistoryAccess(options, createStorage, nativeHistoryAccess);
}
export async function detailedRecordState(filePath: string): Promise<DetailedRecordState> {
    return await inspectDetailedRecordState(filePath, nativeHistoryAccess);
}

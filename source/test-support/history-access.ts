import path from 'node:path';
import { openHistoryAccess, type HistoryAccess, type HistoryAccessRuntime } from '../run/history-state-access.ts';
import type { HistoryOptions } from '../run/history-types.ts';
import type { HistoryStorage } from '../run/history-storage-types.ts';
import { createMemoryHistoryStorage } from './memory-history-storage.ts';
import { defaultRunConfig } from './run-command-factory.ts';

type RunOwner = { readonly name: string; readonly pid: number; readonly host: string; };
type RemovedHistoryPath = { readonly target: string; readonly recursive: boolean; };
export type HistoryAccessScenario = {
    readonly owners: readonly RunOwner[];
    readonly alivePid: number | null;
    readonly foreignLeaseActive: boolean;
    readonly linked: string | null;
    readonly stateDirectory: string;
};
export const idleHistoryScenario: HistoryAccessScenario = {
    owners: [],
    alivePid: null,
    foreignLeaseActive: false,
    linked: null,
    stateDirectory: '.overkill'
};
type MemoryHistoryAccess = {
    readonly access: HistoryAccess;
    readonly options: HistoryOptions;
    readonly runtime: HistoryAccessRuntime;
    readonly store: HistoryStorage;
    readonly removed: readonly RemovedHistoryPath[];
    readonly created: readonly string[];
};
export async function memoryHistoryAccess(input: HistoryAccessScenario): Promise<MemoryHistoryAccess> {
    const store = createMemoryHistoryStorage();
    const options: HistoryOptions = {
        projectRoot: '/project',
        config: defaultRunConfig({ runtimeStateDir: input.stateDirectory })
    };
    const directory = path.resolve(options.projectRoot, input.stateDirectory);
    const removed: RemovedHistoryPath[] = [];
    const created: string[] = [];
    const runtime: HistoryAccessRuntime = {
        async metadata(target) {
            return target === input.linked ? 'symbolic-link' : 'file';
        },
        async readText(target) {
            return await store.read(target) ?? 'null';
        },
        async names(target) {
            return input
                .owners
                .filter(function (owner) {
                    return removed.every(function (entry) {
                        return entry.target !== path.join(target, owner.name);
                    });
                })
                .map(function (owner) {
                    return owner.name;
                });
        },
        async canonical(target) {
            return target;
        },
        async remove(target, recursive) {
            removed.push({ target, recursive });
        },
        host() {
            return 'test-host';
        },
        alive(pid) {
            return pid === input.alivePid;
        },
        async lease() {
            return input.foreignLeaseActive;
        }
    };
    for (const owner of input.owners) {
        await store.write(
            path.join(directory, 'active-runs', owner.name),
            JSON.stringify({ pid: owner.pid, host: owner.host })
        );
    }
    return {
        options,
        runtime,
        store,
        removed,
        created,
        access: openHistoryAccess(options, function (target) {
            created.push(target);
            return store;
        }, runtime)
    };
}

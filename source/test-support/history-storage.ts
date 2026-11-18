import path from 'node:path';
import type { HistoryStorage } from '../run/history-storage-types.ts';
import { createHistoryStorage, type HistoryStorageRuntime } from '../run/node-history-storage.ts';
import { defaultRunConfig } from './run-command-factory.ts';

type HistoryStorageScenario = {
    readonly lockFailure: Error | null;
    readonly leaseFailure: Error | null;
    readonly lockCompromised: Error | null;
    readonly leaseCompromised: Error | null;
};
export const historyStorageScenario: HistoryStorageScenario = {
    lockFailure: null,
    leaseFailure: null,
    lockCompromised: null,
    leaseCompromised: null
};
type HistoryStorageFixture = {
    readonly store: HistoryStorage;
    readonly events: readonly string[];
};
export function historyStorage(input: HistoryStorageScenario): HistoryStorageFixture {
    const content = new Map<string, string>();
    const events: string[] = [];
    const runtime: HistoryStorageRuntime = {
        files: {
            async read(target) {
                return content.get(target) ?? null;
            },
            async write(target, value) {
                content.set(target, value);
            },
            async create(target, value) {
                if (content.has(target)) {
                    throw new Error('Owner exists.');
                }
                content.set(target, value);
            }
        },
        async names(target) {
            return Array
                .from(content.keys())
                .filter(function (file) {
                    return path.dirname(file) === target;
                })
                .map(function (file) {
                    return path.basename(file);
                });
        },
        async prepare(target) {
            events.push(`prepare:${target}`);
        },
        async remove(target) {
            content.delete(target);
            events.push(`remove:${target}`);
        },
        owner() {
            return { pid: 42, host: 'unit-host' };
        },
        async lease(_target, _policy, compromised) {
            events.push('lease');
            if (input.leaseFailure !== null) {
                throw input.leaseFailure;
            }
            if (input.leaseCompromised !== null) {
                compromised(input.leaseCompromised);
            }
            return async function releaseLease() {
                events.push('release-lease');
            };
        },
        async lock(_target, _policy, compromised) {
            events.push('lock');
            if (input.lockFailure !== null) {
                throw input.lockFailure;
            }
            if (input.lockCompromised !== null) {
                compromised(input.lockCompromised);
            }
            return async function releaseLock() {
                events.push('release-lock');
            };
        }
    };
    return { store: createHistoryStorage('/project/state', defaultRunConfig({}).history, runtime), events };
}

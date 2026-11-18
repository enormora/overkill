import { createHistoryAccessRuntime, type HistoryAccessRuntime } from '../run/history-state-access.ts';

export type HistorySystemScenario = {
    readonly status: 'error' | 'file' | 'missing' | 'other' | 'symbolic-link';
    readonly names: 'available' | 'error' | 'missing';
    readonly owner: 'alive' | 'error' | 'missing';
    readonly lease: boolean;
};
export const historySystemScenario: HistorySystemScenario = {
    status: 'file',
    names: 'available',
    owner: 'alive',
    lease: true
};
type HistorySystemFixture = {
    readonly runtime: HistoryAccessRuntime;
    readonly calls: readonly string[];
    readonly failure: Error;
};
function missing(): Error {
    return Object.assign(new Error('Missing.'), { code: 'ENOENT' });
}
export function historySystemAccess(scenario: HistorySystemScenario): HistorySystemFixture {
    const calls: string[] = [];
    const failure = new Error('Access denied.');
    const runtime = createHistoryAccessRuntime({
        async status(target) {
            calls.push(`status:${target}`);
            if (scenario.status === 'missing') {
                throw missing();
            }
            if (scenario.status === 'error') {
                throw failure;
            }
            return {
                isSymbolicLink() {
                    return scenario.status === 'symbolic-link';
                },
                isFile() {
                    return scenario.status === 'file';
                }
            };
        },
        async read(target, encoding) {
            calls.push(`read:${target}:${encoding}`);
            return 'stored text';
        },
        async names(directory) {
            calls.push(`names:${directory}`);
            if (scenario.names === 'missing') {
                throw missing();
            }
            if (scenario.names === 'error') {
                throw failure;
            }
            return [ 'run.json' ];
        },
        async canonical(target) {
            return target;
        },
        async remove(target, options) {
            calls.push(`remove:${target}:${options.recursive}:${options.force}`);
        },
        host() {
            return 'unit-host';
        },
        probe(pid, signal) {
            calls.push(`probe:${pid}:${signal}`);
            if (scenario.owner === 'error') {
                throw failure;
            }
            if (scenario.owner === 'missing') {
                throw Object.assign(new Error('Process absent.'), { code: 'ESRCH' });
            }
        },
        async lease(target, options) {
            calls.push(`lease:${target}:${options.lockfilePath}:${options.stale}`);
            return scenario.lease;
        }
    });
    return { runtime, calls, failure };
}

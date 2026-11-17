import {
    createHistoryLockAcquirer,
    type HistoryLockRelease,
    type HistoryLockOptions
} from '../run/history-lock-acquisition.ts';
import { defaultHistoryPolicy } from '../config/history-policy.ts';

export type HistoryLockScenario = {
    readonly modified: number | null;
    readonly inspection: Error | null;
    readonly acquisition: Error | null;
    readonly failures: number;
    readonly locked: boolean;
    readonly check: Error | null;
    readonly wait: Error | null;
};
export const historyLockScenario: HistoryLockScenario = {
    modified: null,
    inspection: null,
    acquisition: null,
    failures: 0,
    locked: false,
    check: null,
    wait: null
};
type HistoryLockFixture = {
    readonly acquire: () => Promise<HistoryLockRelease>;
    readonly attempts: readonly HistoryLockOptions[];
    readonly waits: readonly number[];
    readonly calls: readonly string[];
    readonly compromised: readonly Error[];
};
function fail(error: Error | null): void {
    if (error !== null) {
        throw error;
    }
}
const currentEpochMilliseconds = 1000;
export function historyLockAcquisition(scenario: HistoryLockScenario, timeout: number): HistoryLockFixture {
    let monotonic = 0;
    const attempts: HistoryLockOptions[] = [];
    const waits: number[] = [];
    const calls: string[] = [];
    const compromised: Error[] = [];
    const acquire = createHistoryLockAcquirer({
        epoch() {
            return currentEpochMilliseconds;
        },
        monotonic() {
            return monotonic;
        },
        async status(path) {
            calls.push(`inspect:${path}`);
            fail(scenario.inspection);
            if (scenario.modified === null) {
                throw Object.assign(new Error('Missing lock.'), { code: 'ENOENT' });
            }
            return { mtimeMs: scenario.modified };
        },
        async acquire(_directory, options) {
            attempts.push(options);
            if (attempts.length <= scenario.failures) {
                throw scenario.acquisition ?? new Error('Lock unavailable.');
            }
            return async function () {
                calls.push('release');
            };
        },
        async check() {
            calls.push('check');
            fail(scenario.check);
            return scenario.locked;
        },
        async wait(milliseconds) {
            waits.push(milliseconds);
            fail(scenario.wait);
            monotonic += milliseconds;
        }
    });
    return {
        attempts,
        waits,
        calls,
        compromised,
        async acquire() {
            return await acquire('/project/state', {
                ...defaultHistoryPolicy,
                staleLockMilliseconds: 50,
                lockTimeoutMilliseconds: timeout
            }, function (error) {
                compromised.push(error);
            });
        }
    };
}

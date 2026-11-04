import { createDeterministicClock } from '@enormora/clock';
import type { RunInputResolutionDependencies, RunInvocation } from '../run/run-input-resolution.ts';
import { updateCompactHistory } from '../run/history-storage.ts';
import { completedHistoryRecord, historyTimestamp, historyWork } from './history-record-fixture.ts';
import { createMemoryHistoryStorage } from './memory-history-storage.ts';
import { defaultRunConfig, defaultRunRequest } from './run-command-factory.ts';

const microsecondsPerMillisecond = 1000n;

type LastFailedRunFixture = {
    readonly invocation: RunInvocation;
    readonly dependencies: RunInputResolutionDependencies;
    readonly recordOutcome: (verdict: 'fail' | 'pass') => Promise<void>;
    readonly writeIndex: (content: string) => Promise<void>;
};

export function lastFailedRunFixture(lastFailed: boolean): LastFailedRunFixture {
    const store = createMemoryHistoryStorage();
    const config = defaultRunConfig();
    const directory = '/project/.overkill';
    const wallClock = createDeterministicClock({
        initialUnixEpochMicroseconds: BigInt(Date.parse(historyTimestamp)) * microsecondsPerMillisecond
    });
    return {
        invocation: {
            namespace: 'test',
            command: {
                config,
                cwd: '/project',
                engine: { kind: 'default' },
                request: defaultRunRequest({ lastFailed, paths: [ 'test.ts' ], seed: { value: 42n } })
            }
        },
        dependencies: {
            wallClock,
            createHistoryStorage() {
                return store;
            },
            async discoverRunFilesWithProjectRoot() {
                return {
                    projectRoot: '/project',
                    files: [ {
                        file: 'test.ts',
                        fileSet: null,
                        path: '/project/test.ts',
                        href: 'file:///project/test.ts'
                    } ]
                };
            }
        },
        async recordOutcome(verdict) {
            const record = completedHistoryRecord('completed');
            await updateCompactHistory(store, {
                ...record,
                result: {
                    ...record.result,
                    summary: { ...record.result.summary, failed: verdict === 'fail' ? 1 : 0 },
                    perTest: [ { workId: historyWork, verdict, durationMicroseconds: 10 } ]
                }
            }, { directory, now: historyTimestamp, policy: config.history, testFamily: 'microtest' });
        },
        async writeIndex(content) {
            await store.write(`${directory}/history/index.json`, content);
        }
    };
}

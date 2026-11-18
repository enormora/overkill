import { openMergedRecordStorage, type MergedRecordStorage } from '../run/merged-record-storage.ts';
import type { MergedSessionRuntime } from '../run/merged-record-session.ts';
import type { MergedRunRecord, MergeResultsCommand } from '../run/merge-results-types.ts';
import { currentRunRecordVersion } from '../run/run-record-format.ts';
import { createMemoryHistoryStorage } from './memory-history-storage.ts';
import { mergeRecordFixture } from './merge-record-fixture.ts';
import { facts } from './run-record-session-fixture.ts';
import { defaultRunConfig } from './run-command-factory.ts';

type MergedSessionScenario = 'delivery' | 'disposal' | 'history' | 'none' | 'write';
type MergedSessionFixture = {
    readonly storage: MergedRecordStorage;
    readonly command: MergeResultsCommand;
    readonly runtime: MergedSessionRuntime;
    readonly events: readonly string[];
    readonly failure: Error;
    readonly content: () => string | null;
};
export async function mergedRecordSession(scenario: MergedSessionScenario): Promise<MergedSessionFixture> {
    const record = mergeRecordFixture('merged', 1, 1);
    const initial: MergedRunRecord = {
        ...record,
        facts,
        version: currentRunRecordVersion,
        kind: 'merged',
        startedAt: '2026-10-30T00:00:00.000Z',
        lineage: [ { id: 'first', path: 'first.json' } ],
        runtime: [ null ],
        versions: { engine: null, packages: {} }
    };
    const command: MergeResultsCommand = {
        cwd: '/project',
        config: defaultRunConfig({}),
        inputs: [ { kind: 'file', path: 'first.json' } ]
    };
    const events: string[] = [];
    const failure = new Error('merged session failed');
    let content: string | null = null;
    const storage = await openMergedRecordStorage(command, initial, {
        files: {
            async write(_file, value) {
                events.push('write');
                if (scenario === 'write') {
                    throw failure;
                }
                content = value;
            }
        },
        history: {
            ...createMemoryHistoryStorage(),
            async beginRun() {
                events.push('begin');
                return async function () {
                    events.push('release');
                };
            },
            async withLock(operation) {
                if (scenario === 'history') {
                    throw failure;
                }
                return await operation();
            }
        },
        now() {
            return initial.startedAt;
        }
    });
    return {
        storage,
        command,
        events,
        failure,
        content() {
            return content;
        },
        runtime: {
            async maintain() {
                events.push('maintain');
                return [ 'maintenance diagnostic' ];
            },
            dispatcher: {
                async createFinalDelivery() {
                    events.push('create-delivery');
                    return {
                        async reportEvent() {
                            return [];
                        },
                        async reportResult() {
                            events.push('report');
                            if (scenario === 'delivery') {
                                throw failure;
                            }
                            return [];
                        },
                        async disposeReporters() {
                            events.push('dispose');
                            if (scenario === 'disposal') {
                                throw failure;
                            }
                            return [];
                        }
                    };
                },
                async trackRunnerErrorDelivery(operation) {
                    return { result: await operation(), deliveredRunnerErrors: [], undeliveredRunnerErrors: [] };
                }
            }
        }
    };
}

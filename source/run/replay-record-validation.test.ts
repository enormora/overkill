import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { workerReplayRecord } from '../test-support/replay-record-fixture.ts';
import { createCollectedPlan, fakeWorkerRuntime } from './worker-pool-execution-state.test.ts';
import { replayRecordSchema } from './replay-record-schema.ts';
import { prepareRecordedReplay } from './replay-preparation.ts';
import type { PreparedReplay } from './replay-types.ts';
import { readRecordedReplay } from './replay-record.ts';
import type { ReplayRunRecord } from './replay-record-types.ts';

type InvalidRecord = { readonly title: string; readonly change: (record: ReplayRunRecord) => unknown; };
type Placement = NonNullable<ReplayRunRecord['facts']['execution']['placementPlan']>;
function retainedRecord(): ReplayRunRecord {
    return workerReplayRecord(fakeWorkerRuntime(createCollectedPlan()), null);
}
function placementOf(record: ReplayRunRecord): Placement {
    const plan = record.facts.execution.placementPlan;
    if (plan === null) {
        throw new Error('Expected fixture placement.');
    }
    return plan;
}
function placedRecord(record: ReplayRunRecord, placementPlan: Placement | null): ReplayRunRecord {
    return { ...record, facts: { ...record.facts, execution: { ...record.facts.execution, placementPlan } } };
}
function invalidRecords(): readonly InvalidRecord[] {
    return [
        {
            title: 'different retained run identity',
            change(record) {
                return { ...record, id: 'different' };
            }
        },
        {
            title: 'seed that differs from its request',
            change(record) {
                return { ...record, seed: '13' };
            }
        },
        {
            title: 'request seed that differs from its facts',
            change(record) {
                return { ...record, request: { ...record.request, seed: { value: '13' } } };
            }
        },
        {
            title: 'facts seed that differs from its record',
            change(record) {
                return {
                    ...record,
                    facts: { ...record.facts, reproducibility: { ...record.facts.reproducibility, seed: '13' } }
                };
            }
        },
        {
            title: 'selection missing its collected metadata',
            change(record) {
                return { ...record, identities: [] };
            }
        },
        {
            title: 'selection missing its case facts',
            change(record) {
                return { ...record, facts: { ...record.facts, cases: [] } };
            }
        },
        {
            title: 'facts belonging to different selected work',
            change(record) {
                return {
                    ...record,
                    facts: {
                        ...record.facts,
                        cases: record
                            .facts
                            .cases
                            .map(function (entry) {
                                return {
                                    ...entry,
                                    workId: { ...entry.workId, case: { ...entry.workId.case, title: 'different' } }
                                };
                            })
                    }
                };
            }
        },
        {
            title: 'collected metadata belonging to different work',
            change(record) {
                return {
                    ...record,
                    replayPlan: {
                        ...record.replayPlan,
                        files: record
                            .replayPlan
                            .files
                            .map(function (file) {
                                return {
                                    ...file,
                                    cases: file.cases.map(function (entry) {
                                        return { ...entry, title: 'different' };
                                    })
                                };
                            })
                    }
                };
            }
        },
        {
            title: 'duplicate collected case metadata',
            change(record) {
                return {
                    ...record,
                    replayPlan: {
                        ...record.replayPlan,
                        files: record
                            .replayPlan
                            .files
                            .map(function (file) {
                                return { ...file, cases: [ ...file.cases, ...file.cases ] };
                            })
                    }
                };
            }
        },
        {
            title: 'placement with duplicate selected work',
            change(record) {
                const plan = placementOf(record);
                return placedRecord(record, {
                    ...plan,
                    units: plan.units.map(function (unit) {
                        return { ...unit, work: [ unit.work[0], unit.work[0] ] };
                    })
                });
            }
        },
        {
            title: 'placement of unrelated work',
            change(record) {
                const plan = placementOf(record);
                return placedRecord(record, {
                    ...plan,
                    units: plan.units.map(function (unit) {
                        return {
                            ...unit,
                            work: [ { ...unit.work[0], case: { ...unit.work[0].case, title: 'different' } } ]
                        };
                    })
                });
            }
        },
        {
            title: 'completed dynamic run without scheduling decisions',
            change(record) {
                return { ...record, status: 'completed', result: { planStatus: 'planned', perTest: [] } };
            }
        },
        {
            title: 'scheduling decisions without placement',
            change(record) {
                const plan = placementOf(record);
                const unit = plan.units[0];
                if (unit === undefined) {
                    throw new Error('Expected fixture work.');
                }
                return {
                    ...placedRecord(record, null),
                    placementTrace: {
                        entries: [ {
                            kind: 'attempt-assigned',
                            attempt: 'attempt-1',
                            lane: 'worker-1',
                            unit: unit.id,
                            work: unit.work,
                            reason: { kind: 'initial' }
                        } ]
                    }
                };
            }
        }
    ];
}
function ignoreRead(): void {
    return undefined;
}
async function readContent(content: string | null, onRead: () => void, runId: string): Promise<ReplayRunRecord> {
    const runtime = fakeWorkerRuntime(createCollectedPlan());
    const run = runtime.resolvedRun;
    return await readRecordedReplay({ cwd: run.cwd, config: run.config, signal: null, runId }, {
        ...runtime.dependencies,
        runtimeStateStore: {
            ...runtime.dependencies.runtimeStateStore,
            async read() {
                onRead();
                return content;
            }
        }
    });
}
async function prepareRecord(record: ReplayRunRecord): Promise<PreparedReplay> {
    const runtime = fakeWorkerRuntime(createCollectedPlan());
    const run = runtime.resolvedRun;
    return await prepareRecordedReplay({ cwd: run.cwd, config: run.config, signal: null, runId: record.id }, {
        ...runtime.dependencies,
        runtimeStateStore: {
            ...runtime.dependencies.runtimeStateStore,
            async read() {
                return JSON.stringify(record);
            }
        }
    });
}
export const testNode = suite('retained replay record validation', [
    test('rejects a saved profile that disagrees with execution facts', async function (scope: TestScope) {
        const record = retainedRecord();
        await scope.assert.rejects(async function inconsistentProfile() {
            await prepareRecord({
                ...record,
                facts: { ...record.facts, execution: { ...record.facts.execution, testFamily: 'microtest' } }
            });
        }, { message: 'Recorded profile and execution facts are inconsistent.' });
        return scope.assert.collect();
    }),
    test('accepts a source without placement decisions', async function (scope: TestScope) {
        const record = replayRecordSchema.parse(placedRecord(retainedRecord(), null));
        scope.assert.deepEqual(await readContent(JSON.stringify(record), ignoreRead, record.id), record);
        return scope.assert.collect();
    }),
    ...invalidRecords().map(function inconsistentRecord(entry) {
        return test(entry.title, async function (scope: TestScope) {
            const record = retainedRecord();
            await scope.assert.rejects(async function rejectInconsistentRecord() {
                await readContent(JSON.stringify(entry.change(record)), ignoreRead, record.id);
            }, { message: /inconsistent|incompatible|scheduling decisions|no placement plan/u });
            return scope.assert.collect();
        });
    }),
    test('accepts a consistent interrupted snapshot', async function (scope: TestScope) {
        const record = retainedRecord();
        const replay = await readContent(JSON.stringify(record), ignoreRead, record.id);
        scope.assert.deepEqual(replay.identities, record.identities);
        scope.assert.equal(replay.placementTrace, null);
        return scope.assert.collect();
    }),
    ...[ null, '{' ].map(function unreadableContent(content) {
        return test(
            content === null ? 'rejects missing run records' : 'rejects malformed run JSON',
            async function (scope: TestScope) {
                await scope.assert.rejects(async function rejectUnreadableRecord() {
                    await readContent(content, ignoreRead, 'retained-worker-run');
                }, { message: /Cannot read replay input/u });
                return scope.assert.collect();
            }
        );
    }),
    test('rejects traversal before reading the store', async function (scope: TestScope) {
        let reads = 0;
        await scope.assert.rejects(async function rejectTraversal() {
            await readContent('{}', function observeRead() {
                reads += 1;
            }, '../outside');
        }, { message: /retained run id/u });
        scope.assert.equal(reads, 0);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);

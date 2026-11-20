import { table, type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import { trackRunnerErrorDelivery } from '../engine/reporter-error-delivery-tracking.ts';

import { createMemoryHistoryStorage } from '../test-support/memory-history-storage.ts';
import { runRecordPolicyFixture } from '../test-support/run-record-policy-fixture.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';

import { runnerResult } from './runner-result.ts';
import { executeRecordedRun } from './recorded-run.ts';
import { readCompactHistory } from './history-storage.ts';

type RunResult = Awaited<ReturnType<typeof executeRecordedRun>>;

async function assertPolicy(scope: TestScope, persist: 'always' | 'on-demand', record: boolean): Promise<void> {
    const fixture = runRecordPolicyFixture(persist, record);
    const result = await executeRecordedRun(
        '/project',
        fixture.input,
        fixture.dependencies,
        async function execute(session) {
            scope.assert.notEqual(session, null);
            scope.assert.equal(fixture.writes.length, 1);
            return runResultFactory.build({ status: 'passed' });
        }
    );
    scope.assert.equal(result.status, 'passed');
    scope.assert.equal(fixture.writes.at(-1)?.detail, persist === 'always' || record ? 'detailed' : 'compact');
    scope.assert.equal(fixture.writes.length, 2);
    scope.assert.equal(fixture.writes[0]?.status, 'started');
    scope.assert.equal(fixture.writes.at(-1)?.status, 'completed');
}

export const testNode: TestNode = suite('run record policy', [
    test('maintenance startup failures remain non-fatal', async function (scope) {
        const fixture = runRecordPolicyFixture('always', false);
        const result = runnerResult(
            await executeRecordedRun('/project', fixture.input, {
                ...fixture.dependencies,
                async maintainHistory() {
                    throw new Error('Maintenance module unavailable');
                }
            }, async function execute() {
                return runResultFactory.build({ status: 'passed' });
            })
        );
        scope.assert.equal(result.status, 'passed');
        scope.assert.deepEqual(result.runnerErrors, []);
        scope.assert.deepEqual(result.maintenanceDiagnostics, [
            'History maintenance failed: Maintenance module unavailable'
        ]);
        return scope.assert.collect();
    }),
    test('maintenance follows completion without changing the verdict', async function (scope) {
        const fixture = runRecordPolicyFixture('always', false);
        const diagnostics = [ 'History maintenance failed: permission denied' ];
        const result = runnerResult(
            await executeRecordedRun('/project', fixture.input, {
                ...fixture.dependencies,
                async maintainHistory() {
                    scope.assert.equal(fixture.writes.at(-1)?.status, 'completed');
                    return diagnostics;
                }
            }, async function execute() {
                return runResultFactory.build({ status: 'passed' });
            })
        );
        scope.assert.equal(result.status, 'passed');
        scope.assert.deepEqual(result.runnerErrors, []);
        scope.assert.deepEqual(result.maintenanceDiagnostics, diagnostics);
        return scope.assert.collect();
    }),
    table({
        title: 'records runs according to persistence policy',
        cases: [ [ 'on-demand', false ], [ 'on-demand', true ], [ 'always', false ], [ 'always', true ] ] as const,
        caseTitle([ persist, record ]) {
            return `${persist}, ${String(record)}`;
        },
        async test(scope) {
            const [ persist, record ] = scope.parameters;

            await assertPolicy(scope, persist, record);
            return scope.assert.collect();
        }
    }),
    test('repeated executions receive separate record identities', async function (scope) {
        const fixture = runRecordPolicyFixture('always', false);
        const execute = async function execute(): Promise<RunResult> {
            return runResultFactory.build({ status: 'passed' });
        };
        await executeRecordedRun('/project', fixture.input, fixture.dependencies, execute);
        await executeRecordedRun('/project', fixture.input, fixture.dependencies, execute);
        scope.assert.equal(fixture.writes.length, 4);
        scope.assert.notEqual(fixture.writes[0]?.id, fixture.writes[2]?.id);
        return scope.assert.collect();
    }),
    test(
        'merge recording reports completion write failures without publishing history',
        async function (scope) {
            const fixture = runRecordPolicyFixture('always', false);
            const input = {
                ...fixture.input,
                request: { ...fixture.input.request, recordForMerge: true, shard: { index: 1, total: 2 } }
            };
            const history = createMemoryHistoryStorage();
            const store = fixture.dependencies.runtimeStateStore;
            let writes = 0;
            const result = runnerResult(
                await executeRecordedRun('/project', input, {
                    ...fixture.dependencies,
                    createHistoryStorage() {
                        return history;
                    },
                    async maintainHistory() {
                        return [ 'Unexpected maintenance' ];
                    },
                    runtimeStateStore: {
                        ...store,
                        async write(filePath, content) {
                            writes += 1;
                            if (writes === 2) {
                                throw new Error('Completion write failed.');
                            }
                            await store.write(filePath, content);
                        }
                    }
                }, async function execute() {
                    return runResultFactory.build({ status: 'passed' });
                })
            );
            const finalRecord = fixture.writes.at(-1);
            const compactHistory = await readCompactHistory(history, '/project/.overkill');
            scope.assert.deepEqual({
                status: result.status,
                runnerError: result.runnerErrors[0]?.subtype,
                recordStatus: finalRecord?.status,
                recordedResult: finalRecord?.result?.status,
                compactHistory,
                diagnostics: result.maintenanceDiagnostics
            }, {
                status: 'failed',
                runnerError: 'runtime-state',
                recordStatus: 'completed',
                recordedResult: 'failed',
                compactHistory: null,
                diagnostics: []
            });
            return scope.assert.collect();
        }
    ),
    test('start write failure blocks execution and returns a runner error', async function (scope) {
        const fixture = runRecordPolicyFixture('always', false);
        let executions = 0;
        const delivery = await trackRunnerErrorDelivery(async function executeFailedRecording() {
            return await executeRecordedRun('/project', fixture.input, {
                ...fixture.dependencies,
                runtimeStateStore: {
                    ...fixture.dependencies.runtimeStateStore,
                    async write() {
                        throw new Error('Disk unavailable.');
                    }
                }
            }, async function execute() {
                executions += 1;
                return runResultFactory.build({ status: 'passed' });
            });
        });
        const { result } = delivery;
        scope.assert.deepEqual(delivery.undeliveredRunnerErrors, result.runnerErrors);
        scope.assert.equal(executions, 0);
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.runnerErrors[0]?.subtype, 'runtime-state');
        return scope.assert.collect();
    })
]);

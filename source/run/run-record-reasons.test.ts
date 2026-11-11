import { runIfMain } from '#test-runner';
import { normalizeConfig } from '../config/config.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { runRecordPolicyFixture } from '../test-support/run-record-policy-fixture.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { withExecutionSession } from './execution-session-context.ts';
import { executeRecordedRun } from './recorded-run.ts';
import { resolveRunRecordPersistence } from './run-profile-facts.ts';

const reasons = [
    [ 'on-demand', false, false, [] ],
    [ 'on-demand', true, false, [ 'request' ] ],
    [ 'on-demand', false, true, [ 'coverage' ] ],
    [ 'on-demand', true, true, [ 'request', 'coverage' ] ],
    [ 'always', false, false, [ 'profile' ] ],
    [ 'always', true, false, [ 'profile', 'request' ] ],
    [ 'always', false, true, [ 'profile', 'coverage' ] ],
    [ 'always', true, true, [ 'profile', 'request', 'coverage' ] ]
] as const;

export const testNode = suite('recording requirements and failures', [
    test('merge recording includes debug persistence in the shared session', async function (scope: TestScope) {
        const fixture = runRecordPolicyFixture('on-demand', false);
        const input = {
            ...fixture.input,
            request: {
                ...fixture.input.request,
                debug: { mode: 'all' as const, selectors: [] as const },
                recordForMerge: true,
                shard: { index: 1, total: 2 }
            }
        };
        scope.assert.deepEqual(resolveRunRecordPersistence(input.request, input.profile), {
            persist: true,
            reasons: [ 'merge', 'debug' ]
        });
        await executeRecordedRun('/project', input, fixture.dependencies, async function execute(record) {
            scope.assert.notEqual(record, null);
            scope.assert.equal(fixture.writes[0]?.status, 'started');
            return runResultFactory.build({ status: 'passed' });
        });
        scope.assert.equal(fixture.writes.at(-1)?.status, 'completed');
        return scope.assert.collect();
    }),
    test(
        'execution sessions reject merge recording even when coverage owns the record',
        async function (scope: TestScope) {
            const fixture = runRecordPolicyFixture('on-demand', false);
            await scope.assert.rejects(async function mergeInsideSession() {
                await withExecutionSession({
                    data: null,
                    lifecycle: { moduleUrl: 'file:///lifecycle.mjs', exportName: 'createLifecycle' }
                }, async function executeMutation() {
                    await executeRecordedRun(
                        '/project',
                        {
                            ...fixture.input,
                            request: { ...fixture.input.request, coverage: true, recordForMerge: true }
                        },
                        fixture.dependencies,
                        async function execute() {
                            return runResultFactory.build();
                        }
                    );
                });
            }, { message: '--record-for-merge is only supported by ordinary runs outside execution sessions.' });
            scope.assert.deepEqual(fixture.writes, []);
            return scope.assert.collect();
        }
    ),
    test('last-failed requires recording without explicit record', async function (scope: TestScope) {
        const fixture = runRecordPolicyFixture('on-demand', false);
        const input = { ...fixture.input, request: { ...fixture.input.request, lastFailed: true } };
        scope.assert.deepEqual(resolveRunRecordPersistence(input.request, input.profile), {
            persist: true,
            reasons: [ 'last-failed' ]
        });
        await executeRecordedRun('/project', input, fixture.dependencies, async function execute(record) {
            scope.assert.equal(record !== null, true);
            return runResultFactory.build({ status: 'passed' });
        });
        scope.assert.equal(fixture.writes.at(-1)?.status, 'completed');
        return scope.assert.collect();
    }),
    ...reasons.map(function persistenceReasons([ persist, record, coverage, expected ]) {
        return test(`${persist}, request ${String(record)}, coverage ${String(coverage)}`, function (scope: TestScope) {
            const fixture = runRecordPolicyFixture(persist, record);
            const facts = resolveRunRecordPersistence({ ...fixture.input.request, coverage }, fixture.input.profile);
            scope.assert.deepEqual(facts, { persist: expected.length > 0, reasons: expected });
            return scope.assert.collect();
        });
    }),
    ...([ 'microtest', 'integration', 'benchmark', 'property' ] as const).map(function profileFamily(testFamily) {
        return test(`${testFamily} normalizes required recording`, function (scope: TestScope) {
            const config = normalizeConfig({
                profiles: {
                    required: {
                        testFamily,
                        files: { include: [ 'case.test.ts' ] },
                        runRecords: { persist: 'always' }
                    }
                }
            });
            const { required } = config.profiles;
            scope.require.defined(required);
            scope.assert.equal(required.runRecords.persist, 'always');
            return scope.assert.collect();
        });
    }),
    test(
        'mutation sessions suppress ordinary recording and its persistence reasons',
        async function (scope: TestScope) {
            const fixture = runRecordPolicyFixture('always', true);
            await withExecutionSession({
                data: null,
                lifecycle: { moduleUrl: 'file:///lifecycle.mjs', exportName: 'createLifecycle' }
            }, async function executeMutation() {
                const facts = resolveRunRecordPersistence(fixture.input.request, fixture.input.profile);
                scope.assert.deepEqual(facts, { persist: false, reasons: [] });
                await executeRecordedRun(
                    '/project',
                    fixture.input,
                    fixture.dependencies,
                    async function execute(record) {
                        scope.assert.equal(record, null);
                        return runResultFactory.build();
                    }
                );
            });
            scope.assert.equal(fixture.writes.length, 0);
            return scope.assert.collect();
        }
    ),
    test(
        'coverage retains ownership of its record when ordinary recording is requested',
        async function (scope: TestScope) {
            const fixture = runRecordPolicyFixture('always', true);
            await executeRecordedRun(
                '/project',
                {
                    ...fixture.input,
                    request: { ...fixture.input.request, coverage: true }
                },
                fixture.dependencies,
                async function execute(record) {
                    scope.assert.equal(record, null);
                    return runResultFactory.build();
                }
            );
            scope.assert.equal(fixture.writes.length, 0);
            return scope.assert.collect();
        }
    ),
    test('escaping execution failures leave an interrupted record', async function (scope: TestScope) {
        const fixture = runRecordPolicyFixture('always', false);
        await scope.assert.rejects(async function runInterrupted() {
            await executeRecordedRun('/project', fixture.input, fixture.dependencies, async function execute() {
                throw new Error('Execution escaped.');
            });
        }, { message: 'Execution escaped.' });
        scope.assert.equal(fixture.writes.at(-1)?.status, 'interrupted');
        scope.assert.equal(fixture.writes.at(-1)?.result?.status, 'failed');
        return scope.assert.collect();
    }),
    test(
        'interruption persistence failures retain the execution failure in an aggregate',
        async function (scope: TestScope) {
            const fixture = runRecordPolicyFixture('always', false);
            let writes = 0;
            await scope.assert.rejects(async function runFailedInterruption() {
                await executeRecordedRun('/project', fixture.input, {
                    ...fixture.dependencies,
                    runtimeStateStore: {
                        ...fixture.dependencies.runtimeStateStore,
                        async write() {
                            writes += 1;
                            if (writes > 1) {
                                throw new Error('Interruption write failed.');
                            }
                        }
                    }
                }, async function execute() {
                    throw new Error('Execution escaped.');
                });
            }, { name: 'AggregateError', message: 'Execution and run record persistence failed.' });
            scope.assert.equal(writes, 2);
            return scope.assert.collect();
        }
    )
]);

await runIfMain(import.meta, testNode);

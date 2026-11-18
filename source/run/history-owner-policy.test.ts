import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { testDouble } from '../packages/doubles/doubles.entry-point.ts';
import { memoryHistoryAccess, idleHistoryScenario } from '../test-support/history-access.ts';
import { completedHistoryRecord } from '../test-support/history-record-fixture.ts';
import { openHistoryAccess, inspectDetailedRecordState } from './history-state-access.ts';

export const testNode = suite('history ownership metadata boundaries', [
    test('rejects missing metadata for a listed run owner', async function (scope: TestScope) {
        const fixture = await memoryHistoryAccess({
            ...idleHistoryScenario,
            owners: [ { name: 'missing.json', pid: 42, host: 'test-host' } ]
        });
        const access = openHistoryAccess(fixture.options, function () {
            return {
                ...fixture.store,
                async read() {
                    return null;
                }
            };
        }, fixture.runtime);
        await scope.assert.rejects(access.assertIdle, { name: 'ZodError' });
        scope.assert.deepEqual(fixture.removed, []);
        return scope.assert.collect();
    }),
    test('preserves non-error storage failures as classified history errors', async function (scope: TestScope) {
        const fixture = await memoryHistoryAccess(idleHistoryScenario);
        await scope.assert.rejects(async function () {
            await fixture.access.guarded(async function () {
                return testDouble.throws(42)();
            });
        }, { name: 'RunCollectionError', message: 'History operation failed: 42', cause: { exact: 42 } });
        return scope.assert.collect();
    }),
    test('marks valid records without replay plans as unavailable', async function (scope: TestScope) {
        const fixture = await memoryHistoryAccess(idleHistoryScenario);
        const record = { ...completedHistoryRecord('record'), replayPlan: null };
        scope.assert.equal(
            await inspectDetailedRecordState('/record.json', {
                ...fixture.runtime,
                async readText() {
                    return JSON.stringify(record);
                }
            }),
            'unavailable'
        );
        return scope.assert.collect();
    }),
    test(
        'permits nested state directories while rejecting directories containing the project',
        async function (scope: TestScope) {
            const fixture = await memoryHistoryAccess({ ...idleHistoryScenario, stateDirectory: '.overkill/nested' });
            await fixture.access.assertOwnedLocation();
            const access = openHistoryAccess({
                ...fixture.options,
                config: {
                    ...fixture
                        .options
                        .config,
                    runtimeStateDir: '..'
                },
                projectRoot: '/project/nested'
            }, function () {
                return fixture.store;
            }, fixture.runtime);
            await scope.assert.rejects(access.assertOwnedLocation, {
                message: 'History state must have its own directory.'
            });
            scope.assert.deepEqual(fixture.removed, []);
            return scope.assert.collect();
        }
    )
]);
await runIfMain(import.meta, testNode);

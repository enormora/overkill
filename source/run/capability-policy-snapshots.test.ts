import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { createSnapshotCheckpoints, type RuntimeSnapshotChange } from './capability-policy-snapshots.ts';

export const testNode = suite('capability policy snapshots', [
    test('nested observations retain the outer environment checkpoint', async function (scope) {
        const environment: Record<string, string | undefined> = {};
        const changes: RuntimeSnapshotChange[] = [];
        const checkpoints = createSnapshotCheckpoints({
            observeIpcListeners() {
                return function () {
                    return undefined;
                };
            },
            observeProcessExit() {
                return function () {
                    return undefined;
                };
            },
            readEnvironment() {
                return environment;
            },
            readStorage() {
                return null;
            }
        }, function recordChange(change) {
            changes.push(change);
        });
        await checkpoints.observe('attempt', async function () {
            await checkpoints.observe('attempt', async function () {
                await Promise.resolve();
            });
            environment.TEST_VALUE = 'changed';
        });
        const value = await checkpoints.observe('attempt', async function () {
            return await Promise.resolve('repeated');
        });
        scope.assert.deepEqual(changes, [ 'environment' ]);
        scope.assert.equal(value, 'repeated');
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);

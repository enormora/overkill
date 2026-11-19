import { suite as authoredSuite, test } from '@overkill-dev/test';
import { readProcessEnvironment, readWebStorage } from './node-host-readers.ts';

import {
    createSnapshotCheckpoints,
    isRuntimeCapabilityPolicyEnvironment,
    type RuntimeSnapshotChange
} from './capability-policy-snapshots.ts';

export const testNode = authoredSuite('capability policy snapshots', [
    test('runtime capability policy host readers reject invalid host values', function (scope) {
        const invalidProcess = { env: { NUMBER: 1 } };
        const invalidHost = { sessionStorage: { length: '1' } };

        scope.assert.equal(isRuntimeCapabilityPolicyEnvironment({ VALID: 'value', OMITTED: undefined }), true);
        scope.assert.equal(isRuntimeCapabilityPolicyEnvironment({ INVALID: 1 }), false);
        scope.assert.deepEqual(readProcessEnvironment(invalidProcess), {});
        scope.assert.equal(readWebStorage(invalidHost, 'sessionStorage'), null);

        return scope.assert.collect();
    }),

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

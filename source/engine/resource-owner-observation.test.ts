import { suite, test } from '../packages/test/test.entry-point.ts';
import { testNode as resourceOwnerCompletionTestNode } from './resource-owner-completion.test.ts';
import {
    observeCaseResourceOwners,
    observeResourceOwnerAcquisition,
    releaseResourceOwner
} from './resource-owner-observation.ts';

export const testNode = suite('resource owner observation', [
    resourceOwnerCompletionTestNode,
    test('allows owned handles while retaining unrelated handles for leak checks', async function (scope) {
        const resources = [ 'infrastructure' ];
        const observed = await observeCaseResourceOwners(function () {
            return resources;
        }, async function () {
            await observeResourceOwnerAcquisition(async function () {
                resources.push('server');
                return 'registry';
            });
            resources.push('server');
        });
        scope.assert.deepEqual(observed.baseline, [ 'infrastructure', 'server' ]);
        scope.assert.deepEqual(resources, [ 'infrastructure', 'server', 'server' ]);
        return scope.assert.collect();
    }),
    test('checks owner handles again when their lifetime ends in another case', async function (scope) {
        const resources: string[] = [];
        const acquired = await observeCaseResourceOwners(function () {
            return resources;
        }, async function () {
            return await observeResourceOwnerAcquisition(async function () {
                resources.push('server');
                return 'registry';
            });
        });
        const disposed = await observeCaseResourceOwners(function () {
            return resources;
        }, async function () {
            releaseResourceOwner(acquired.result.owner);
        });
        scope.assert.deepEqual(disposed.baseline, []);
        scope.assert.deepEqual(resources, [ 'server' ]);
        return scope.assert.collect();
    }),
    test('does not allow handles left behind by failed acquisition', async function (scope) {
        const resources: string[] = [];
        const observed = await observeCaseResourceOwners(function () {
            return resources;
        }, async function () {
            await scope.assert.rejects(async function () {
                return observeResourceOwnerAcquisition(async function () {
                    resources.push('server');
                    throw new Error('startup failed');
                });
            }, { message: 'startup failed' });
        });
        scope.assert.deepEqual(observed.baseline, []);
        scope.assert.deepEqual(resources, [ 'server' ]);
        return scope.assert.collect();
    })
]);

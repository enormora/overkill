import { AsyncResource } from 'node:async_hooks';
import { createServer } from 'node:net';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { testNode as nativeWriteOwnershipTestNode } from './native-write-ownership.test.ts';
import { createAsyncLeakMonitor } from './async-leak-diagnostics.ts';
import { testNode as resourceOwnerCompletionTestNode } from './resource-owner-completion.test.ts';
import { testNode as nativeResourceOwnershipTestNode } from './native-resource-ownership.test.ts';
import {
    observeCaseResourceOwners,
    observeResourceOwnerAcquisition,
    releaseResourceOwner
} from './resource-owner-observation.ts';

const unownedContext = new AsyncResource('unowned-resource-context');

export const testNode = suite('resource owner observation', [
    resourceOwnerCompletionTestNode,
    nativeResourceOwnershipTestNode,
    nativeWriteOwnershipTestNode,
    test('acquires and releases resources outside a case observation', async function (scope) {
        const acquired = await unownedContext.runInAsyncScope(async function () {
            const result = await observeResourceOwnerAcquisition(async function () {
                return 'registry';
            });
            releaseResourceOwner(result.owner);
            return result;
        });
        scope.assert.equal(acquired.value, 'registry');
        scope.assert.deepEqual(acquired.owner.resources, []);
        return scope.assert.collect();
    }),
    test('retains unrelated resources when a released owner is absent', async function (scope) {
        const observed = await observeCaseResourceOwners(function () {
            return [ 'server' ];
        }, async function () {
            releaseResourceOwner({ resources: [ 'socket' ] });
        });
        scope.assert.deepEqual(observed.baseline, [ 'server' ]);
        return scope.assert.collect();
    }),
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
    }),
    test('does not assign another concurrent acquisition native handles', async function (scope) {
        const monitor = createAsyncLeakMonitor();
        scope.cleanup(monitor.stop);
        const server = createServer();
        scope.cleanup(async function () {
            await new Promise<void>(function close(resolve, reject) {
                server.close(function closed(error) {
                    if (error === undefined) {
                        resolve();
                    } else {
                        reject(error);
                    }
                });
            });
        });
        const ready = Promise.withResolvers<undefined>();
        const observed = await observeCaseResourceOwners(function () {
            return process.getActiveResourcesInfo();
        }, async function () {
            const workspace = observeResourceOwnerAcquisition(async function () {
                await ready.promise;
                return 'workspace';
            });
            const registry = await observeResourceOwnerAcquisition(async function () {
                await new Promise<void>(function listen(resolve) {
                    server.listen(0, '127.0.0.1', resolve);
                });
                return 'registry';
            });
            ready.resolve(undefined);
            const acquiredWorkspace = await workspace;
            releaseResourceOwner(acquiredWorkspace.owner);
            return { registry, workspace: acquiredWorkspace };
        });
        scope.assert.true(observed.result.registry.owner.resources.includes('TCPServerWrap'));
        scope.assert.false(observed.result.workspace.owner.resources.includes('TCPServerWrap'));
        scope.assert.true(observed.baseline.includes('TCPServerWrap'));
        return scope.assert.collect();
    })
]);

const { runIfMain } = await import('#test-runner');
await runIfMain(import.meta, testNode);

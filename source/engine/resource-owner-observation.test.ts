import { createServer } from 'node:net';
import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { testNode as nativeWriteOwnershipTestNode } from './native-write-ownership.test.ts';
import { createAsyncLeakMonitor } from './async-leak-diagnostics.ts';
import { testNode as nativeResourceOwnershipTestNode } from './native-resource-ownership.test.ts';
import {
    observeCaseResourceOwners,
    observeResourceOwnerAcquisition,
    releaseResourceOwner
} from './resource-owner-observation.ts';

export const testNode = suite('resource owner observation', [
    nativeResourceOwnershipTestNode,
    nativeWriteOwnershipTestNode,
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

await runIfMain(import.meta, testNode);

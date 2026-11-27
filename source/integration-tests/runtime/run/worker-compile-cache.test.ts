import { access } from 'node:fs/promises';
import { suite, test } from '@overkill-dev/test';
import {
    createWorkerCompileCache,
    currentWorkerCompileCache,
    withWorkerCompileCache
} from '../../../run/worker-compile-cache.ts';

export const testNode = suite('fresh worker compile cache', [
    test('claims one writer across lanes and shares the seeded directory', async function (scope) {
        const cache = createWorkerCompileCache('collect');
        const [ seed, competing ] = await Promise.all([ cache.claim('collect'), cache.claim('run') ]);
        scope.assert.equal(seed?.mode, 'seed');
        scope.assert.null(competing);
        cache.seedCompleted();
        const reader = await cache.claim('run');
        scope.assert.equal(reader?.directory, seed?.directory);
        scope.assert.equal(reader?.mode, 'read-only');
        await cache.dispose();
        return scope.assert.collect();
    }),
    test('retries a failed seed and removes its directory on disposal', async function (scope) {
        const directory = await withWorkerCompileCache('run', async function retrySeed() {
            const cache = currentWorkerCompileCache();
            if (cache === null) {
                throw new Error('Expected an active worker cache.');
            }
            const collection = await cache.claim('collect');
            const first = await cache.claim('run');
            cache.seedFailed();
            const retry = await cache.claim('run');
            scope.assert.null(collection);
            scope.assert.equal(retry?.directory, first?.directory);
            scope.assert.equal(retry?.mode, 'seed');
            return retry?.directory;
        });
        if (directory === undefined) {
            throw new Error('Expected an acquired worker cache directory.');
        }
        await scope.assert.rejects(async function readDisposedDirectory() {
            await access(directory);
        }, { code: 'ENOENT' });
        return scope.assert.collect();
    })
]);

import { mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { createGeneratedFileOwnership } from './generated-file-ownership.ts';

async function directory(scope: TestScope): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), 'overkill-generated-ownership-'));
    scope.cleanup(async function cleanup() {
        await rm(path, { recursive: true, force: true });
    });
    return path;
}
export const testNode = suite('generated file ownership', [
    test('preserves collisions and removes earlier owned writes', async function (scope: TestScope) {
        const path = await directory(scope);
        const ownership = createGeneratedFileOwnership();
        await writeFile(join(path, 'existing'), 'original');
        await ownership.write(join(path, 'generated'), 'generated');
        await scope.assert.rejects(async function collision() {
            await ownership.write(join(path, 'existing'), 'replacement');
        }, { message: /EEXIST/u });
        await ownership.cleanup();
        scope.assert.equal(await readFile(join(path, 'existing'), 'utf8'), 'original');
        scope.assert.deepEqual(await readdir(path), [ 'existing' ]);
        return scope.assert.collect();
    }),
    test('preserves a symlink substituted for an owned file', async function (scope: TestScope) {
        const path = await directory(scope);
        const ownership = createGeneratedFileOwnership();
        await writeFile(join(path, 'original'), 'original');
        await ownership.write(join(path, 'generated'), 'original');
        await unlink(join(path, 'generated'));
        await symlink(join(path, 'original'), join(path, 'generated'));
        await scope.assert.rejects(async function changedIdentity() {
            await ownership.cleanup();
        }, { message: 'Generated input cleanup failed.' });
        scope.assert.equal(await readFile(join(path, 'generated'), 'utf8'), 'original');
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);

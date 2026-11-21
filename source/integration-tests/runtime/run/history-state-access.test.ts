import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type TestScope, suite, test } from '@overkill-dev/test';

import { normalizeConfig } from '../../../packages/run/run.entry-point.ts';
import { createMemoryHistoryStorage } from '../../../test-support/memory-history-storage.ts';
import { createHistoryAccess, detailedRecordState } from '../../../run/history-state-access.ts';

async function stateDirectory(cleanup: TestScope['cleanup']): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), 'overkill-history-access-'));
    cleanup(async function removeState() {
        await rm(directory, { recursive: true, force: true });
    });
    return directory;
}

export const testNode = suite('retained history access', [
    test('classifies invalid records and directories as unavailable', async function (scope) {
        const directory = await stateDirectory(scope.cleanup);
        const file = path.join(directory, 'record.json');
        await writeFile(file, '{}');
        scope.assert.equal(await detailedRecordState(file), 'unavailable');
        await writeFile(file, '{');
        scope.assert.equal(await detailedRecordState(file), 'unavailable');
        scope.assert.equal(await detailedRecordState(directory), 'unavailable');
        scope.assert.equal(await detailedRecordState(path.join(directory, 'missing.json')), 'pruned');
        return scope.assert.collect();
    }),
    test(
        'propagates filesystem failures instead of treating them as pruned records',
        async function (scope) {
            const directory = await stateDirectory(scope.cleanup);
            const file = path.join(directory, 'blocked');
            await writeFile(file, 'not a directory');
            await scope.assert.rejects(async function readBlockedRecord() {
                return await detailedRecordState(path.join(file, 'record.json'));
            }, { code: 'ENOTDIR' });
            return scope.assert.collect();
        }
    ),
    test('rejects missing ownership metadata before maintenance can proceed', async function (scope) {
        const directory = await stateDirectory(scope.cleanup);
        await mkdir(path.join(directory, '.overkill', 'active-runs'), { recursive: true });
        await writeFile(path.join(directory, '.overkill', 'active-runs', 'owner.json'), '{}');
        const access = createHistoryAccess(
            { projectRoot: directory, config: normalizeConfig({}) },
            createMemoryHistoryStorage
        );
        await scope.assert.rejects(async function verifyOwner() {
            await access.assertIdle();
        }, { name: 'ZodError' });
        return scope.assert.collect();
    })
]);

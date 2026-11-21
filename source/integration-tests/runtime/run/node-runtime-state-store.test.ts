import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { chmod, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { suite, test } from '@overkill-dev/test';

import { createNodeFileStore } from '../../../file-store.ts';

const assertBlockedReplacement = defineCompositeAssertion({
    name: 'blocked replacement',
    async assert(check, directory: string) {
        const store = createNodeFileStore();
        const blockedPath = path.join(directory, 'runs', 'blocked.json');
        await mkdir(blockedPath);
        const initialChecks = check.group([
            await check.rejects(async function writeBlockedRecord() {
                await store.write(blockedPath, 'record');
            }, { code: 'EISDIR' }),
            await check.rejects(async function readDirectory() {
                await store.read(blockedPath);
            }, { code: 'EISDIR' })
        ]);
        const entries = await readdir(path.dirname(blockedPath));
        return check.group([
            initialChecks,
            check.deepEqual(
                entries.toSorted(function compareNames(first, second) {
                    return first.localeCompare(second);
                }),
                [ 'blocked.json', 'record.json' ]
            )
        ]);
    }
});

const assertDeniedStorageErrors = defineCompositeAssertion({
    name: 'denied runtime state storage',
    async assert(check, directory: string) {
        await chmod(directory, 0);
        try {
            const failure = await createNodeFileStore().write(path.join(directory, 'record.json'), 'record').catch((
                error: unknown
            ) => error);
            if (!(failure instanceof AggregateError)) {
                return check.instanceOf(failure, AggregateError);
            }
            const errors: readonly unknown[] = failure.errors;
            return check.group([
                check.equal(failure.name, 'AggregateError'),
                check.equal(failure.message, 'Runtime state write and cleanup failed.'),
                check.equal(errors.length, 2),
                check.equal(failure.cause, errors[1]),
                ...errors.map(function permissionFailure(error) {
                    return error instanceof Error
                        ? check.equal(Reflect.get(error, 'code'), 'EACCES')
                        : check.instanceOf(error, Error);
                })
            ]);
        } finally {
            await chmod(directory, 0o700);
        }
    }
});

export const testNode = suite('Node runtime state store', [
    test('preserves write and cleanup errors when storage access is denied', async function (scope) {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'overkill-record-'));
        try {
            await scope.assert(assertDeniedStorageErrors, directory);
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
        return scope.assert.collect();
    }),
    test(
        'atomically replaces records and removes sibling temporary files after a failed rename',
        async function (scope) {
            const directory = await mkdtemp(path.join(os.tmpdir(), 'overkill-record-'));
            const filePath = path.join(directory, 'runs', 'record.json');
            try {
                scope.assert.equal(await createNodeFileStore().read(filePath), null);
                await createNodeFileStore().write(filePath, '{"status":"started"}');
                await createNodeFileStore().write(filePath, '{"status":"completed"}');
                scope.assert.equal(await createNodeFileStore().read(filePath), '{"status":"completed"}');
                await scope.assert(assertBlockedReplacement, directory);
            } finally {
                await rm(directory, { force: true, recursive: true });
            }
            return scope.assert.collect();
        }
    )
]);

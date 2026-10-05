import { chmod, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { createNodeRuntimeStateStore } from './node-runtime-state-store.ts';

async function assertBlockedReplacement(scope: TestScope, directory: string): Promise<void> {
    const store = createNodeRuntimeStateStore();
    const blockedPath = path.join(directory, 'runs', 'blocked.json');
    await mkdir(blockedPath);
    await scope.assert.rejects(async function writeBlockedRecord() {
        await store.write(blockedPath, 'record');
    }, { code: 'EISDIR' });
    await scope.assert.rejects(async function readDirectory() {
        await store.read(blockedPath);
    }, { code: 'EISDIR' });
    const entries = await readdir(path.dirname(blockedPath));
    scope.assert.deepEqual(
        entries.toSorted(function compareNames(first, second) {
            return first.localeCompare(second);
        }),
        [ 'blocked.json', 'record.json' ]
    );
}

async function assertWriteAndCleanupFailures(scope: TestScope, filePath: string): Promise<void> {
    try {
        await createNodeRuntimeStateStore().write(filePath, 'record');
    } catch (error: unknown) {
        scope.require.instanceOf(error, AggregateError);
        const failures: readonly unknown[] = error.errors;
        scope.assert.equal(failures.length, 2);
        for (const failure of failures) {
            scope.require.instanceOf(failure, Error);
            scope.assert.equal(Reflect.get(failure, 'code'), 'EACCES');
        }
        scope.assert.equal(error.cause, failures[1]);
        throw error;
    }
}

async function assertDeniedStorageErrors(scope: TestScope, directory: string): Promise<void> {
    await chmod(directory, 0);
    try {
        await scope.assert.rejects(async function writeDeniedRecord() {
            await assertWriteAndCleanupFailures(scope, path.join(directory, 'record.json'));
        }, { name: 'AggregateError', message: 'Runtime state write and cleanup failed.' });
    } finally {
        await chmod(directory, 0o700);
    }
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/node-runtime-state-store.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'preserves write and cleanup errors when storage access is denied',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                const directory = await mkdtemp(path.join(os.tmpdir(), 'overkill-record-'));
                try {
                    await assertDeniedStorageErrors(scope, directory);
                } finally {
                    await rm(directory, { force: true, recursive: true });
                }
                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'atomically replaces records and removes sibling temporary files after a failed rename',
            annotations: {},
            controls: {},
            async body(scope) {
                const directory = await mkdtemp(path.join(os.tmpdir(), 'overkill-record-'));
                const filePath = path.join(directory, 'runs', 'record.json');
                try {
                    scope.assert.equal(await createNodeRuntimeStateStore().read(filePath), null);
                    await createNodeRuntimeStateStore().write(filePath, '{"status":"started"}');
                    await createNodeRuntimeStateStore().write(filePath, '{"status":"completed"}');
                    scope.assert.equal(await createNodeRuntimeStateStore().read(filePath), '{"status":"completed"}');
                    await assertBlockedReplacement(scope, directory);
                } finally {
                    await rm(directory, { force: true, recursive: true });
                }
                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);

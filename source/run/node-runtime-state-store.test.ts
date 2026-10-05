import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
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

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/node-runtime-state-store.test.ts',
    annotations: {},
    controls: {},
    children: [
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

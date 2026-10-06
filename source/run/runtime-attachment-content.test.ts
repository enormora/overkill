import { readFile } from 'node:fs/promises';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { attachmentFixture } from '../test-support/attachment-fixture.ts';
import { createAttachmentRetention, type AttachmentRetention } from './attachment-retention.ts';

const definition = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

async function assertRepeatedTextFinish(scope: TestScope): Promise<void> {
    const { directory } = await attachmentFixture(scope, defaultAttachmentLimits);
    const retention = await createAttachmentRetention('text', process.cwd(), `${directory}/log`, 10);
    await retention.retain(Buffer.from('ready'), 10);
    await retention.finish({ kind: 'complete' });
    await retention.finish({ kind: 'incomplete', reason: 'interrupted' });
    scope.assert.deepEqual(retention.content(), {
        kind: 'text',
        text: 'ready',
        byteLength: 5,
        completion: { kind: 'complete' }
    });
}

async function assertJsonCompletion(scope: TestScope): Promise<void> {
    const { directory } = await attachmentFixture(scope, defaultAttachmentLimits);
    const interrupted = await createAttachmentRetention('json', process.cwd(), `${directory}/json`, 10);
    await interrupted.retain(Buffer.from('{'), 10);
    await interrupted.finish({ kind: 'incomplete', reason: 'unclosed' });
    scope.assert.deepEqual(interrupted.content(), { kind: 'omitted', limit: 10, reason: 'byte-limit' });
    const expanded = await createAttachmentRetention('json', process.cwd(), `${directory}/expanded`, 3);
    await expanded.retain(Buffer.from('1e9'), 3);
    await expanded.finish({ kind: 'complete' });
    scope.assert.deepEqual(expanded.content(), { kind: 'omitted', limit: 3, reason: 'byte-limit' });
}

async function assertClosedFile(scope: TestScope, retention: AttachmentRetention, filePath: string): Promise<void> {
    await retention.finish({ kind: 'complete' });
    await scope.assert.rejects(async function rejectWriteAfterFileClose() {
        await retention.retain(Uint8Array.of(2), 10);
    }, { message: 'file closed' });
    const bytes = await readFile(filePath);
    scope.assert.deepEqual(Array.from(bytes), [ 1 ]);
    scope.assert.deepEqual(retention.content(), {
        kind: 'file',
        path: filePath,
        byteLength: 1,
        completion: { kind: 'incomplete', reason: 'byte-limit' }
    });
}

async function assertFileClosure(scope: TestScope): Promise<void> {
    const { directory } = await attachmentFixture(scope, defaultAttachmentLimits);
    const filePath = `${directory}/screenshot.bin`;
    const retention = await createAttachmentRetention('binary', process.cwd(), filePath, 10);
    scope.cleanup(async function finishRetainedFile() {
        await retention.finish({ kind: 'incomplete', reason: 'unclosed' });
    });
    await retention.retain(Uint8Array.of(1), 10);
    await retention.finish({ kind: 'truncated', reason: 'byte-limit' });
    await assertClosedFile(scope, retention, filePath);
}
export const testNode = createSuite({
    ...definition,
    title: 'source/run/runtime-attachment-content.test.ts',
    children: ([ [ 'text completion remains stable when finalization repeats', assertRepeatedTextFinish ], [
        'incomplete JSON and canonical expansion respect inline limits',
        assertJsonCompletion
    ], [ 'binary finalization closes the file and retains explicit truncation', assertFileClosure ] ] as const)
        .map(function contentCase([ title, check ]) {
            return createTestCase({
                ...definition,
                title,
                async body(scope: TestScope) {
                    await check(scope);
                    return scope.assert.collect();
                }
            });
        })
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);

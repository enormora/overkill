import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { readFile } from 'node:fs/promises';
import { test, suite } from '@overkill-dev/test';

import { defaultAttachmentLimits } from '../../../engine/runtime-attachment.ts';
import { attachmentFixture } from '../../../test-support/attachment-fixture.ts';
import { createAttachmentRetention, type AttachmentRetention } from '../../../run/attachment-retention.ts';

const assertClosedFile = defineCompositeAssertion({
    name: 'closed file',
    async assert(check, retention: AttachmentRetention, filePath: string) {
        await retention.finish({ kind: 'complete' });
        const initialChecks = await check.rejects(async function rejectWriteAfterFileClose() {
            await retention.retain(Uint8Array.of(2), 10);
        }, { message: 'file closed' });
        const bytes = await readFile(filePath);
        return check.group([
            initialChecks,
            check.deepEqual(Array.from(bytes), [ 1 ]),
            check.deepEqual(retention.content(), {
                kind: 'file',
                path: filePath,
                byteLength: 1,
                completion: { kind: 'incomplete', reason: 'byte-limit' }
            })
        ]);
    }
});

export const testNode = suite('Runtime attachment content', [
    test('keeps text completion stable across repeated finalization', async (scope) => {
        const { directory } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
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

        return scope.assert.collect();
    }),
    test('bounds incomplete JSON and canonical expansion', async (scope) => {
        const { directory } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        const interrupted = await createAttachmentRetention('json', process.cwd(), `${directory}/json`, 10);
        await interrupted.retain(Buffer.from('{'), 10);
        await interrupted.finish({ kind: 'incomplete', reason: 'unclosed' });
        scope.assert.deepEqual(interrupted.content(), { kind: 'omitted', limit: 10, reason: 'byte-limit' });
        const expanded = await createAttachmentRetention('json', process.cwd(), `${directory}/expanded`, 3);
        await expanded.retain(Buffer.from('1e9'), 3);
        await expanded.finish({ kind: 'complete' });
        scope.assert.deepEqual(expanded.content(), { kind: 'omitted', limit: 3, reason: 'byte-limit' });

        return scope.assert.collect();
    }),
    test('closes binary files while retaining truncation', async (scope) => {
        const { directory } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        const filePath = `${directory}/screenshot.bin`;
        const retention = await createAttachmentRetention('binary', process.cwd(), filePath, 10);
        scope.cleanup(async function finishRetainedFile() {
            await retention.finish({ kind: 'incomplete', reason: 'unclosed' });
        });
        await retention.retain(Uint8Array.of(1), 10);
        await retention.finish({ kind: 'truncated', reason: 'byte-limit' });
        await scope.assert(assertClosedFile, retention, filePath);

        return scope.assert.collect();
    })
]);

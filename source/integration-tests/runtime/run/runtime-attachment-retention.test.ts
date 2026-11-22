import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { defineMacro, suite, test } from '@overkill-dev/test';

import { defaultAttachmentLimits } from '../../../engine/runtime-attachment.ts';
import {
    attachmentFixture,
    type AttachmentFixture,
    attachmentPeerWork,
    attachmentWork
} from '../../../test-support/attachment-fixture.ts';
import type { AttachmentExchange } from '../../../run/attachment-protocol.ts';
import { createAttachmentServer } from '../../../run/attachment-server.ts';
import { createAttachmentConnection } from '../../../run/attachment-connection.ts';

const metadata = { name: 'screenshot', mediaType: 'image/png' };

async function openBinaryEvidence(
    exchange: AttachmentExchange,
    branch: string | null,
    attempt: number
): Promise<number> {
    const opened = await exchange({
        kind: 'open',
        branch,
        contentKind: 'binary',
        metadata,
        owner: { kind: 'case', work: attachmentWork, attempt: { index: attempt } },
        producer: { kind: 'case' }
    });
    if (opened.kind !== 'opened') {
        throw new Error('Expected an attachment writer.');
    }
    return opened.writer;
}

const assertInterruptedFile = defineCompositeAssertion({
    name: 'interrupted file',
    async assert(check, store: Awaited<ReturnType<typeof attachmentFixture>>['store']) {
        const artifact = store.artifacts()[0];
        if (artifact === undefined) {
            return check.defined(artifact);
        }

        const { content } = artifact.payload;
        if (content.kind !== 'file') {
            throw new Error('Expected a retained file.');
        }
        const intermediateChecks = check.group([
            check.deepEqual(content.completion, { kind: 'incomplete', reason: 'interrupted' }),
            check.deepEqual(Array.from(await readFile(path.resolve(content.path))), [ 1, 2, 3 ])
        ]);
        if (artifact.id.attempt === null) {
            return check.group([ intermediateChecks, check.defined(artifact.id.attempt) ]);
        }
        return check.group([
            intermediateChecks,
            check.defined(
                artifact
                    .id
                    .attempt
            ),
            check.deepEqual(artifact.id.attempt, { index: 1 })
        ]);
    }
});

const assertConcurrentOwners = defineMacro(function (title: string) {
    return test(title, async function (scope) {
        const { execution, store } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        const firstReady = Promise.withResolvers<undefined>();
        const secondReady = Promise.withResolvers<undefined>();
        await Promise.all(
            [ attachmentWork, attachmentPeerWork ].map(async function captureOverlappingAttempt(work, index) {
                await execution.runAttempt(work, { index: 0 }, async function writeOwnedEvidence() {
                    const writer = await execution.context.forProducer({ kind: 'case' }).open({
                        ...metadata,
                        kind: 'text'
                    });
                    await writer.write(work.case.title);
                    if (index === 0) {
                        firstReady.resolve(undefined);
                        await secondReady.promise;
                    } else {
                        secondReady.resolve(undefined);
                        await firstReady.promise;
                    }
                    await writer.close();
                });
            })
        );
        for (const artifact of store.artifacts()) {
            if (artifact.id.scope.kind !== 'case' || artifact.payload.content.kind !== 'text') {
                throw new Error('Expected owned text.');
            }
            scope.assert.equal(artifact.payload.content.text, artifact.id.scope.case.title);
        }
        scope.assert.equal(store.artifacts().length, 2);

        return scope.assert.collect();
    });
});

const removedCancelledFile = defineCompositeAssertion({
    name: 'prunes the cancelled file from disk',
    async assert(check, store: AttachmentFixture['store']) {
        const content = store.artifacts()[0]?.payload.content;
        if (content?.kind !== 'file') {
            return check.partialDeepEqual<unknown, unknown>(content, { kind: 'file' });
        }
        await store.prune(store.selectedArtifacts());
        return await check.rejects(async function () {
            await readFile(path.resolve(content.path));
        }, { code: 'ENOENT' });
    }
});
export const testNode = suite('Runtime attachment retention', [
    test('channel EOF preserves binary prefixes and interrupted ownership', async function (scope) {
        const { store } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        const server = await createAttachmentServer(store, defaultAttachmentLimits);
        scope.cleanup(async function finishAttachmentChannel() {
            await server.finish();
        });
        const connection = createAttachmentConnection(server.endpoint);
        await connection.ready;
        const writer = await openBinaryEvidence(connection.exchange, null, 1);
        await connection.exchange({
            kind: 'write',
            writer,
            data: Buffer.from([ 1, 2, 3 ]).toString('base64')
        });
        await new Promise<void>(function disconnectAttachment(resolve) {
            connection.observeDisconnect(resolve);
            connection.close();
        });
        await scope.assert(assertInterruptedFile, store);

        return scope.assert.collect();
    }),
    test('cancelled branch files are removed without failing retained work', async function (scope) {
        const { store } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        store.registerBranch('cancelled', function discardBranch() {
            return false;
        });
        const writer = await openBinaryEvidence(store.exchange.bind(null, 'peer'), 'cancelled', 0);
        await store.exchange('peer', { kind: 'write', writer, data: Buffer.from([ 4 ]).toString('base64') });
        scope.assert.deepEqual(await store.finish('peer'), []);
        await scope.assert(removedCancelledFile, store);

        return scope.assert.collect();
    }),
    assertConcurrentOwners('overlapping cases retain their original attachment owners')
]);

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { attachmentFixture, attachmentPeerWork, attachmentWork } from '../test-support/attachment-fixture.ts';
import type { AttachmentExchange } from './attachment-protocol.ts';
import { createAttachmentServer } from './attachment-server.ts';
import { createAttachmentConnection } from './attachment-connection.ts';

const metadata = { name: 'screenshot', mediaType: 'image/png' };
const definition = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

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

async function assertInterruptedFile(
    scope: TestScope,
    store: Awaited<ReturnType<typeof attachmentFixture>>['store']
): Promise<void> {
    const artifact = store.artifacts()[0];
    scope.require.defined(artifact);
    const { content } = artifact.payload;
    if (content.kind !== 'file') {
        throw new Error('Expected a retained file.');
    }
    scope.assert.deepEqual(content.completion, { kind: 'incomplete', reason: 'interrupted' });
    scope.assert.deepEqual(Array.from(await readFile(path.resolve(content.path))), [ 1, 2, 3 ]);
    scope.require.defined(artifact.id.attempt);
    scope.assert.deepEqual(artifact.id.attempt, { index: 1 });
}

async function assertInterruptedChannel(scope: TestScope): Promise<void> {
    const { store } = await attachmentFixture(scope, defaultAttachmentLimits);
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
    await assertInterruptedFile(scope, store);
}

async function assertDiscardedBranch(scope: TestScope): Promise<void> {
    const { store } = await attachmentFixture(scope, defaultAttachmentLimits);
    store.registerBranch('cancelled', function discardBranch() {
        return false;
    });
    const writer = await openBinaryEvidence(store.exchange.bind(null, 'peer'), 'cancelled', 0);
    await store.exchange('peer', { kind: 'write', writer, data: Buffer.from([ 4 ]).toString('base64') });
    scope.assert.deepEqual(await store.finish('peer'), []);
    const content = store.artifacts()[0]?.payload.content;
    if (content?.kind !== 'file') {
        throw new Error('Expected discarded file evidence.');
    }
    await store.prune(store.selectedArtifacts());
    await scope.assert.rejects(async function removedCancelledFile() {
        await readFile(path.resolve(content.path));
    }, { code: 'ENOENT' });
}

async function assertConcurrentOwners(scope: TestScope): Promise<void> {
    const { execution, store } = await attachmentFixture(scope, defaultAttachmentLimits);
    const firstReady = Promise.withResolvers<undefined>();
    const secondReady = Promise.withResolvers<undefined>();
    await Promise.all([ attachmentWork, attachmentPeerWork ].map(async function captureOverlappingAttempt(work, index) {
        await execution.runAttempt(work, { index: 0 }, async function writeOwnedEvidence() {
            const writer = await execution.context.forProducer({ kind: 'case' }).open({ ...metadata, kind: 'text' });
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
    }));
    for (const artifact of store.artifacts()) {
        if (artifact.id.scope.kind !== 'case' || artifact.payload.content.kind !== 'text') {
            throw new Error('Expected owned text.');
        }
        scope.assert.equal(artifact.payload.content.text, artifact.id.scope.case.title);
    }
    scope.assert.equal(store.artifacts().length, 2);
}

export const testNode = createSuite({
    ...definition,
    title: 'source/run/runtime-attachment-retention.test.ts',
    children: [
        createTestCase({
            ...definition,
            title: 'channel EOF preserves binary prefixes and interrupted ownership',
            async body(scope: TestScope) {
                await assertInterruptedChannel(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'cancelled branch files are removed without failing retained work',
            async body(scope: TestScope) {
                await assertDiscardedBranch(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'overlapping cases retain their original attachment owners',
            async body(scope: TestScope) {
                await assertConcurrentOwners(scope);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);

import { AsyncResource } from 'node:async_hooks';
import {
    createFailureArtifactStream,
    closeAttemptFailureStreams,
    type FailureArtifactStream
} from '../attachments/failure-artifact-stream.ts';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import {
    attachmentFixture,
    type AttachmentFixture,
    attachmentWork as work
} from '../test-support/attachment-fixture.ts';
import { attachmentsForProducer } from '../attachments/attachment-context.ts';
import { runWithAttachmentExecution } from './resource-lifecycle-state.ts';

const definition = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const metadata = { mediaType: 'application/json', name: 'evidence' };

async function assertExpiredAttempt(scope: TestScope): Promise<void> {
    const { execution, store } = await attachmentFixture(scope, defaultAttachmentLimits);
    const deferred = Promise.withResolvers<() => Promise<unknown>>();
    await runWithAttachmentExecution(execution, async function scheduleLateAttachment() {
        await execution.runAttempt(work, { index: 0 }, async function firstAttempt() {
            const attachments = attachmentsForProducer({ kind: 'case' });
            deferred.resolve(AsyncResource.bind(async function emitExpiredAttachment() {
                return await attachments.json(metadata, { late: true });
            }));
        });
    });
    const expired = await deferred.promise;
    await scope.assert.rejects(expired, { message: 'Attachment escaped its test attempt.' });
    const errors = execution.takeErrors({ kind: 'run' });
    scope.assert.equal(errors[0]?.subtype, 'attribution-drift');
    scope.assert.equal(errors[0]?.attributedToWork, null);
    scope.assert.equal(store.artifacts().length, 0);
}

async function assertRetryBudget(scope: TestScope): Promise<void> {
    const limits = { ...defaultAttachmentLimits, maxScopeBytes: 3, maxScopeAttachments: 2 };
    const { execution, store } = await attachmentFixture(scope, limits);
    await runWithAttachmentExecution(execution, async function writeAcrossRetryChain() {
        for (const index of [ 0, 1 ]) {
            await execution.runAttempt(work, { index }, async function writeAttempt() {
                const writer = await attachmentsForProducer({ kind: 'case' }).open({
                    kind: 'text',
                    mediaType: 'text/plain',
                    name: 'log'
                });
                await writer.write('ab');
                await writer.close();
            });
        }
        await scope.assert.rejects(async function exceedRetryCount() {
            await execution.runAttempt(work, { index: 2 }, async function thirdAttempt() {
                await attachmentsForProducer({ kind: 'case' }).json(metadata, {});
            });
        }, { message: 'Attachment count limit exceeded.' });
    });
    const retained = store.artifacts().map(function retainedText(artifact) {
        return artifact.payload.content.kind === 'text' ? artifact.payload.content.text : null;
    });
    scope.assert.deepEqual(retained, [ 'ab', 'a' ]);
    scope.assert.equal(execution.takeErrors({ attempt: { index: 2 }, kind: 'case', work }).length, 1);
}

async function assertCaughtJsonErrors(scope: TestScope): Promise<void> {
    const { execution, store } = await attachmentFixture(scope, { ...defaultAttachmentLimits, maxInlineBytes: 5 });
    await runWithAttachmentExecution(execution, async function rejectInvalidAndOmitLargeJson() {
        await execution.runAttempt(work, { index: 0 }, async function captureJson() {
            const attachments = attachmentsForProducer({ kind: 'case' });
            const omitted = await attachments.json(metadata, { large: 'evidence' });
            scope.assert.deepEqual(omitted.payload.content, { kind: 'omitted', limit: 5, reason: 'byte-limit' });
            await scope.assert.rejects(async function invalidJson() {
                await attachments.json(metadata, Number.NaN);
            }, { name: 'AttachmentOperationError' });
        });
    });
    scope.assert.equal(store.artifacts().length, 1);
    scope.assert.equal(execution.takeErrors({ attempt: { index: 0 }, kind: 'case', work }).length, 1);
}

async function assertMissingSourceFile(scope: TestScope): Promise<void> {
    const { execution, store, directory } = await attachmentFixture(scope, defaultAttachmentLimits);
    await execution.runAttempt(work, { index: 0 }, async function copyMissingSource() {
        await scope.assert.rejects(async function missingFile() {
            await execution.context.forProducer({ kind: 'case' }).file(metadata, `${directory}/missing.log`);
        }, { name: 'AttachmentOperationError' });
    });
    scope.assert.equal(execution.takeErrors({ kind: 'case', work, attempt: { index: 0 } }).length, 1);
    const content = store.artifacts()[0]?.payload.content;
    scope.require.defined(content);
    if (content.kind !== 'file') {
        throw new Error('Expected a retained file.');
    }
    scope.assert.deepEqual(content.completion, { kind: 'incomplete', reason: 'write-error' });
    scope.assert.equal(content.byteLength, 0);
}

async function assertRejectedTextBytes(scope: TestScope, byte: number): Promise<void> {
    const { execution, store } = await attachmentFixture(scope, { ...defaultAttachmentLimits, maxInlineBytes: 2 });
    await execution.runAttempt(work, { index: 0 }, async function retainValidPrefix() {
        const writer = await execution.context.forProducer({ kind: 'case' }).open({
            kind: 'text',
            name: 'log',
            mediaType: 'text/plain'
        });
        await writer.write('a');
        await scope.assert.rejects(async function rejectMalformedText() {
            await writer.write(Uint8Array.of(byte));
            await writer.close();
        }, { name: 'AttachmentOperationError' });
    });
    scope.assert.equal(execution.takeErrors({ kind: 'case', work, attempt: { index: 0 } }).length, 1);
    const content = store.artifacts()[0]?.payload.content;
    scope.require.defined(content);
    scope.assert.deepEqual(content, {
        kind: 'text',
        text: 'a',
        byteLength: 1,
        completion: { kind: 'incomplete', reason: 'write-error' }
    });
}

async function assertExpiredRun(scope: TestScope): Promise<void> {
    const { execution, store } = await attachmentFixture(scope, defaultAttachmentLimits);
    const attachments = execution.context.forProducer({ kind: 'resource', name: 'service' });
    await attachments.json(metadata, { ready: true });
    await execution.finish();
    await scope.assert.rejects(async function rejectLateRunAttachment() {
        await attachments.json(metadata, { late: true });
    }, { message: 'Attachment escaped its integration run.' });
    scope.assert.equal(store.artifacts().length, 1);
    scope.assert.equal(execution.takeErrors({ kind: 'run' })[0]?.subtype, 'attribution-drift');
}

async function assertLateServiceOutput(scope: TestScope): Promise<void> {
    const { execution, store } = await attachmentFixture(scope, defaultAttachmentLimits);
    const captured = Promise.withResolvers<FailureArtifactStream>();
    await runWithAttachmentExecution(execution, async function captureFirstAttempt() {
        await execution.runAttempt(work, { index: 0 }, async function serviceOutput() {
            const stream = createFailureArtifactStream(
                { name: 'service', condition: { kind: 'attempt', work, attempt: { index: 0 } } },
                'boundary-captured',
                'stdout',
                'text/plain'
            );
            if (stream === null) {
                throw new Error('Expected managed service capture.');
            }
            stream.write('first attempt');
            await stream.close();
            captured.resolve(stream);
        });
    });
    const stream = await captured.promise;
    stream.write('late output');
    const errors = await execution.finish();
    scope.assert.equal(errors[0]?.subtype, 'attribution-drift');
    scope.assert.equal(store.artifacts().length, 1);
}
async function assertSeparateRunStreams(scope: TestScope): Promise<void> {
    const [ left, right ] = await Promise.all([
        attachmentFixture(scope, defaultAttachmentLimits),
        attachmentFixture(scope, defaultAttachmentLimits)
    ]);
    const rightStarted = Promise.withResolvers<undefined>();
    const leftFinished = Promise.withResolvers<undefined>();
    async function finishRight(stream: FailureArtifactStream): Promise<void> {
        rightStarted.resolve(undefined);
        await leftFinished.promise;
        stream.write(' end');
        await stream.close();
    }
    async function finishLeft(): Promise<void> {
        await rightStarted.promise;
        await closeAttemptFailureStreams(work, { index: 0 });
        leftFinished.resolve(undefined);
    }
    async function capturedAttempt(fixture: AttachmentFixture, side: 'left' | 'right'): Promise<void> {
        await runWithAttachmentExecution(fixture.execution, async function ownedRun() {
            await fixture.execution.runAttempt(work, { index: 0 }, async function sharedWorkIdentity() {
                const stream = createFailureArtifactStream(
                    { name: 'service', condition: { kind: 'attempt', work, attempt: { index: 0 } } },
                    'boundary-captured',
                    'stdout',
                    'text/plain'
                );
                if (stream === null) {
                    throw new Error('Expected managed service capture.');
                }
                stream.write(side);
                await (side === 'right' ? finishRight(stream) : finishLeft());
            });
        });
    }
    await Promise.all([ capturedAttempt(left, 'left'), capturedAttempt(right, 'right') ]);
    const artifact = right.store.artifacts()[0];
    scope.require.defined(artifact);
    scope.assert.partialDeepEqual(artifact.payload.content, { kind: 'text', text: 'right end' });
}
export const testNode = createSuite({
    ...definition,
    title: 'source/run/runtime-attachment-ownership.test.ts',
    children: [
        createTestCase({
            ...definition,
            title: 'simultaneous runs keep service streams with identical work identities separate',
            async body(scope: TestScope) {
                await assertSeparateRunStreams(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'late service output preserves its expired attempt attribution',
            async body(scope: TestScope) {
                await assertLateServiceOutput(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'captured resource attachment APIs reject writes after the integration run ends',
            async body(scope: TestScope) {
                await assertExpiredRun(scope);
                return scope.assert.collect();
            }
        }),
        ...[ 255, 195 ].map(function invalidTextByte(byte) {
            return createTestCase({
                ...definition,
                title: `rejects malformed UTF-8 byte ${byte} without exceeding the text limit`,
                async body(scope: TestScope) {
                    await assertRejectedTextBytes(scope, byte);
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            ...definition,
            title: 'file read errors retain incomplete evidence and fail the owning attempt',
            async body(scope: TestScope) {
                await assertMissingSourceFile(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'expired attempts fail without attributing evidence to another attempt',
            async body(scope: TestScope) {
                await assertExpiredAttempt(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'attachment budgets span every attempt in a retry chain',
            async body(scope: TestScope) {
                await assertRetryBudget(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...definition,
            title: 'oversized JSON is omitted and caught validation errors still fail the attempt',
            async body(scope: TestScope) {
                await assertCaughtJsonErrors(scope);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { TestScope } from '../engine/test-node.ts';
import { createDefaultWorkId, type WorkId } from '../engine/identity.ts';
import type { AttachmentLimits } from '../engine/runtime-attachment.ts';
import { createAttachmentStore, type AttachmentStore } from '../run/attachment-store.ts';
import { createAttachmentExecution, type AttachmentExecution } from '../run/attachment-execution.ts';

export const attachmentWork = createDefaultWorkId({
    file: 'attachments.test.ts',
    params: null,
    suite: [],
    title: 'attachment'
});
export const attachmentPeerWork = createDefaultWorkId({
    file: 'attachments.test.ts',
    params: null,
    suite: [],
    title: 'peer'
});
export type AttachmentFixture = {
    readonly directory: string;
    readonly execution: AttachmentExecution;
    readonly store: AttachmentStore;
};
export async function attachmentFixtureForWork(
    scope: TestScope,
    limits: AttachmentLimits,
    work: readonly WorkId[]
): Promise<AttachmentFixture> {
    await mkdir('target/attachment-tests', { recursive: true });
    const directory = await mkdtemp('target/attachment-tests/run-');
    scope.cleanup(async function removeAttachmentRun() {
        await rm(directory, { recursive: true, force: true });
    });
    const store = createAttachmentStore({
        captureTime() {
            return 0;
        },
        checkpoint: async function checkpointArtifacts() {
            return undefined;
        },
        directory,
        limits,
        projectRoot: process.cwd(),
        work
    });
    const execution = createAttachmentExecution(async function exchangeAttachment(operation) {
        return await store.exchange('test', operation);
    }, limits.maxInlineBytes);
    return { directory, execution, store };
}
export async function attachmentFixture(scope: TestScope, limits: AttachmentLimits): Promise<AttachmentFixture> {
    return attachmentFixtureForWork(scope, limits, [ attachmentWork, attachmentPeerWork ]);
}

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { TestScope } from '@overkill-dev/test';
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
function createAttachmentFixture(
    directory: string,
    limits: AttachmentLimits,
    work: readonly WorkId[]
): AttachmentFixture {
    const store = createAttachmentStore({
        witnessDirectory: `${directory}/witnesses`,
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
    }, limits);
    return { directory, execution, store };
}

export async function attachmentFixtureForWork(
    cleanup: TestScope['cleanup'],
    limits: AttachmentLimits,
    work: readonly WorkId[]
): Promise<AttachmentFixture> {
    await mkdir('target/attachment-tests', { recursive: true });
    const directory = await mkdtemp('target/attachment-tests/run-');
    cleanup(async function removeAttachmentRun() {
        await rm(directory, { recursive: true, force: true });
    });
    return createAttachmentFixture(directory, limits, work);
}

export function inlineAttachmentFixture(limits: AttachmentLimits, work: readonly WorkId[]): AttachmentFixture {
    return createAttachmentFixture('/project/attachments', limits, work);
}

export async function attachmentFixture(
    cleanup: TestScope['cleanup'],
    limits: AttachmentLimits
): Promise<AttachmentFixture> {
    return attachmentFixtureForWork(cleanup, limits, [ attachmentWork, attachmentPeerWork ]);
}

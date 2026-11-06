import path from 'node:path';
import type { AttachmentLimits } from '../engine/runtime-attachment.ts';
import { createAttachmentStore, type AttachmentStore } from './attachment-store.ts';
import { createAttachmentServer, type AttachmentServer } from './attachment-server.ts';
import type { AttachmentRecord } from './attachment-record.ts';
import type { ResolvedRun } from './run-types.ts';

export type AttachmentStorageSession = {
    readonly store: AttachmentStore;
    readonly server: AttachmentServer;
    readonly resolved: ResolvedRun;
};
export function createRunAttachmentStore(
    resolved: ResolvedRun,
    record: AttachmentRecord,
    limits: AttachmentLimits
): AttachmentStore {
    return createAttachmentStore({
        witnessDirectory: path.resolve(
            resolved.facts.environment.projectRoot,
            resolved.config.runtimeStateDir,
            'witnesses',
            record.session.id
        ),
        captureTime: record.captureTime,
        checkpoint: record.checkpoint,
        directory: path.resolve(
            resolved.facts.environment.projectRoot,
            resolved.config.runtimeStateDir,
            'runs',
            record.session.id,
            'artifacts'
        ),
        limits,
        projectRoot: resolved.facts.environment.projectRoot,
        work: resolved.facts.cases.map(function workIdentity(entry) {
            return entry.workId;
        })
    });
}

export async function createAttachmentStorageSession(
    resolved: ResolvedRun,
    record: AttachmentRecord
): Promise<AttachmentStorageSession> {
    const limits = resolved.facts.execution.attachments;
    if (limits === null) {
        throw new TypeError('Runtime attachments require integration limits.');
    }
    const store = createRunAttachmentStore(resolved, record, limits);
    return { resolved, server: await createAttachmentServer(store, limits), store };
}

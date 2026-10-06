import { AsyncLocalStorage } from 'node:async_hooks';
import type { AttemptId, WorkId } from '../engine/identity.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import type { AttachmentEndpoint } from './attachment-protocol.ts';

export type AttachmentCoordinator = {
    readonly endpoint: AttachmentEndpoint;
    readonly branchEndpoint: (branch: Readonly<Record<string, unknown>>, retain: () => boolean) => AttachmentEndpoint;
    readonly branchArtifacts: (branch: Readonly<Record<string, unknown>>) => readonly RuntimeAttachmentArtifact[];
    readonly caseArtifacts: (
        work: WorkId,
        attempt: AttemptId,
        branch: Readonly<Record<string, unknown>> | null
    ) => readonly RuntimeAttachmentArtifact[];
    readonly finalize: (result: RunResult) => Promise<RunResult>;
};

const coordinatorContext = new AsyncLocalStorage<AttachmentCoordinator>();

export function currentAttachmentCoordinator(): AttachmentCoordinator | null {
    return coordinatorContext.getStore() ?? null;
}

export async function runWithAttachmentCoordinator<Value>(
    coordinator: AttachmentCoordinator,
    run: () => Promise<Value>
): Promise<Value> {
    return await coordinatorContext.run(coordinator, run);
}

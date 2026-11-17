import { defaultAttachmentLimits, type RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import type { WorkId, AttemptId } from '../engine/identity.ts';
import { createAttachmentCoordinator, type AttachmentRunCoordinator } from '../run/attachment-coordinator.ts';
import type { AttachmentStore } from '../run/attachment-store.ts';
import { inlineAttachmentFixture, attachmentWork, attachmentPeerWork } from './attachment-fixture.ts';
import { runResultFactory } from './run-result-factory.ts';

type AttachmentCoordinationFixture = {
    readonly coordinator: AttachmentRunCoordinator;
    readonly store: AttachmentStore;
    readonly calls: readonly string[];
};
export const attachmentCoordinationResult = runResultFactory.build({
    status: 'passed',
    planStatus: 'planned',
    summary: { planned: 1, passed: 1 },
    perTest: [ { id: attachmentWork.case, workId: attachmentWork, verdict: 'pass' } ]
});
export function attachmentCoordinationForWork(
    failure: Error | null,
    work: readonly WorkId[]
): AttachmentCoordinationFixture {
    const { store } = inlineAttachmentFixture(defaultAttachmentLimits, work);
    const calls: string[] = [];
    return {
        store,
        calls,
        coordinator: createAttachmentCoordinator({
            policy: 'first-failure-and-final',
            store: {
                ...store,
                async prune(artifacts) {
                    calls.push('prune');
                    await store.prune(artifacts);
                }
            },
            server: {
                endpoint: {
                    port: 4321,
                    token: '00000000-0000-4000-8000-000000000000',
                    branch: null,
                    limits: defaultAttachmentLimits
                },
                async finish() {
                    calls.push('finish');
                    if (failure !== null) {
                        throw failure;
                    }
                    return await store.finish(null);
                }
            }
        })
    };
}
export function attachmentCoordination(failure: Error | null): AttachmentCoordinationFixture {
    return attachmentCoordinationForWork(failure, [ attachmentWork, attachmentPeerWork ]);
}
export async function captureCoordinatedAttachment(
    coordinator: AttachmentRunCoordinator,
    work: WorkId,
    attempt: AttemptId,
    branch: string | null
): Promise<RuntimeAttachmentArtifact> {
    return await coordinator.execution.runBranch(branch, async function () {
        return await coordinator.execution.runAttempt(work, attempt, async function () {
            return await coordinator.execution.context.forProducer({ kind: 'case' }).json({
                name: 'evidence',
                mediaType: 'application/json'
            }, { value: 42 });
        });
    });
}

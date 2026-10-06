import type { RunResult } from '../engine/run-result.ts';
import { createAttachmentStorageSession } from './attachment-storage-session.ts';
import { createAttachmentRecord, type AttachmentRecord } from './attachment-record.ts';
import { createAttachmentRunCoordinator, type AttachmentRunCoordinator } from './attachment-coordinator.ts';
import { runWithAttachmentExecution } from './resource-lifecycle-state.ts';
import { runWithAttachmentCoordinator } from './attachment-coordinator-context.ts';
import { runHasAttachmentScopes } from './attachment-eligibility.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { ResolvedRun } from './run-types.ts';

async function executeAttachmentSession(
    record: AttachmentRecord,
    coordinator: AttachmentRunCoordinator,
    run: () => Promise<RunResult>
): Promise<RunResult> {
    try {
        const result = await runWithAttachmentCoordinator(
            coordinator,
            async function () {
                return runWithAttachmentExecution(coordinator.execution, run);
            }
        );
        return await record.session.complete(await coordinator.finalize(result));
    } catch (error: unknown) {
        await coordinator.close();
        try {
            await record.checkpoint(coordinator.artifacts());
        } finally {
            await record.session.interrupt(error);
        }
        throw error;
    } finally {
        await coordinator.close();
    }
}

export async function executeWithAttachments(
    resolved: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    run: () => Promise<RunResult>
): Promise<RunResult> {
    if (!runHasAttachmentScopes(resolved)) {
        return await run();
    }
    const record = await createAttachmentRecord(resolved, dependencies);
    const coordinator = createAttachmentRunCoordinator(await createAttachmentStorageSession(resolved, record));
    return await executeAttachmentSession(record, coordinator, run);
}

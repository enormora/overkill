import type { RunResult } from '../engine/run-result.ts';
import { createAttachmentStorageSession } from './attachment-storage-session.ts';
import { createAttachmentRecord, type AttachmentRecord } from './attachment-record.ts';
import { createAttachmentRunCoordinator, type AttachmentRunCoordinator } from './attachment-coordinator.ts';
import { runWithAttachmentExecution } from './resource-lifecycle-state.ts';
import { runWithAttachmentCoordinator } from './attachment-coordinator-context.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { ResolvedRun } from './run-types.ts';
import { runHasAttachmentScopes } from './run-facts.ts';
import { executeWithPropertyWitnesses } from './property-witness-storage.ts';

type AttachmentCompletion = {
    readonly complete: (result: RunResult) => Promise<RunResult>;
    readonly interrupt: AttachmentRecord['session']['interrupt'];
};
async function finalizeAttachmentSession(coordinator: AttachmentRunCoordinator, result: RunResult): Promise<RunResult> {
    const finalized = await coordinator.finalize(result);
    await coordinator.close();
    return finalized;
}

async function executeAttachmentSession(
    record: AttachmentRecord,
    coordinator: AttachmentRunCoordinator,
    run: () => Promise<RunResult>,
    completion: AttachmentCompletion
): Promise<RunResult> {
    try {
        const result = await runWithAttachmentCoordinator(
            coordinator,
            async function () {
                return runWithAttachmentExecution(coordinator.execution, run);
            }
        );
        return await completion.complete(await finalizeAttachmentSession(coordinator, result));
    } catch (error: unknown) {
        await coordinator.close();
        try {
            await record.checkpoint(coordinator.artifacts());
        } finally {
            await completion.interrupt(error);
        }
        throw error;
    } finally {
        await coordinator.close();
    }
}

export async function executeWithAttachments(
    resolved: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    run: () => Promise<RunResult>,
    session: AttachmentRecord['session'] | null
): Promise<RunResult> {
    if (resolved.facts.execution.testFamily === 'property') {
        return await executeWithPropertyWitnesses(resolved, dependencies, run, session);
    }
    if (!runHasAttachmentScopes(resolved)) {
        return await run();
    }
    const record = await createAttachmentRecord(resolved, dependencies, session);
    const coordinator = createAttachmentRunCoordinator(await createAttachmentStorageSession(resolved, record));
    const completion = session === null ? record.session : {
        complete: record.session.checkpointResult,
        async interrupt() {
            return undefined;
        }
    };
    return await executeAttachmentSession(record, coordinator, run, completion);
}

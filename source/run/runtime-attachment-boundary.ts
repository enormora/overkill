import type { RunResult } from './run-engine-primitives.ts';
import { currentExecutionSession } from './execution-session-context.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { ResolvedRun } from './run-types.ts';
import { currentAttachmentCoordinator, type AttachmentCoordinator } from './attachment-coordinator-context.ts';
import { runHasAttachmentScopes } from './run-facts.ts';
import type { RunRecordSession } from './run-record.ts';

export type RunAttachmentRecord = RunRecordSession | null;

export const activeRuntimeAttachments: () => AttachmentCoordinator | null = currentAttachmentCoordinator;
export async function executeWithRuntimeAttachments(
    resolved: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    run: () => Promise<RunResult>,
    record: RunAttachmentRecord
): Promise<RunResult> {
    if (currentExecutionSession() !== null || !runHasAttachmentScopes(resolved)) {
        return await run();
    }
    const { executeWithAttachments } = await import('./attachment-run.ts');
    return await executeWithAttachments(resolved, dependencies, run, record);
}

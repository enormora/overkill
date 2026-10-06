import type { RunResult } from './run-engine-primitives.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { ResolvedRun } from './run-types.ts';
import { runHasAttachmentScopes } from './attachment-eligibility.ts';
import { currentAttachmentCoordinator, type AttachmentCoordinator } from './attachment-coordinator-context.ts';

export const activeRuntimeAttachments: () => AttachmentCoordinator | null = currentAttachmentCoordinator;
export async function executeWithRuntimeAttachments(
    resolved: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    run: () => Promise<RunResult>
): Promise<RunResult> {
    if (!runHasAttachmentScopes(resolved)) {
        return await run();
    }
    const { executeWithAttachments } = await import('./attachment-run.ts');
    return await executeWithAttachments(resolved, dependencies, run);
}

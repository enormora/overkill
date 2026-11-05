import { runStatusFromPlan } from '../engine/run-result.ts';
import type { RecordedCoverageExecution } from './recorded-coverage-types.ts';
import { currentReplay } from './replay-context.ts';
import { createResolvedRunFromCollection } from './run-collected-resolution.ts';
import { executeEmptyShardRun } from './run-empty-shard.ts';
import { finalizeResultWithDurationHistory } from './run-state-finalization.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunCommand, ResolvedRun } from './run-types.ts';

type EmptyReplayInput = {
    readonly command: RunCommand;
    readonly input: ResolvedRunInput;
    readonly dependencies: RunOrchestratorDependencies;
    readonly record: RecordedCoverageExecution['record'] | null;
};
type EmptyReplayExecution = EmptyReplayInput & { readonly coverage: RecordedCoverageExecution['session'] | null; };
async function executeEmptyReplay(
    options: EmptyReplayExecution
): Promise<Awaited<ReturnType<RunOrchestratorDependencies['execute']>>> {
    const replay = currentReplay();
    if (replay?.kind !== 'record') {
        throw new TypeError('Expected recorded replay.');
    }
    const collected = await createResolvedRunFromCollection({
        ...options.input,
        ...options,
        collection: { collectedPlan: replay.record.replayPlan, runnerErrors: [] },
        durationHistoryIndex: null,
        allowEmptySelection: true,
        planKind: 'supervised'
    });
    const resolved: ResolvedRun = {
        ...collected,
        request: { ...collected.request, lastFailed: replay.record.request.lastFailed },
        plan: { kind: 'empty-shard', collectedPlan: replay.record.replayPlan }
    };
    await options.record?.recordResolvedRun(resolved);
    return await executeEmptyShardRun(resolved, options.dependencies, async function finalize(run, result) {
        const planStatus = replay.record.result?.planStatus ?? result.planStatus;
        const restored = {
            ...result,
            planStatus,
            status: runStatusFromPlan(result.summary, result.runnerErrors, planStatus)
        };
        const covered = options.coverage === null ? restored : await options.coverage.finalize(restored);
        return await finalizeResultWithDurationHistory(options.dependencies, run, covered, null);
    }, null);
}
async function executeRequestedEmptyReplay(
    options: EmptyReplayInput
): Promise<Awaited<ReturnType<RunOrchestratorDependencies['execute']>>> {
    if (!options.input.request.coverage) {
        return await executeEmptyReplay({ ...options, coverage: null });
    }
    const { runRecordedCoverage } = await import('./recorded-coverage-run.ts');
    return await runRecordedCoverage({
        ...options,
        timing: null,
        async execute({ record, session }) {
            return await executeEmptyReplay({ ...options, record, coverage: session });
        }
    });
}
export function replayEmptySelection(
    options: EmptyReplayInput
): Promise<Awaited<ReturnType<RunOrchestratorDependencies['execute']>>> | null {
    const replay = currentReplay();
    return replay?.kind === 'record' && replay.record.identities.length === 0
        ? executeRequestedEmptyReplay(options)
        : null;
}

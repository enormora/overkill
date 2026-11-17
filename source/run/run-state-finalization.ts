import type { RunResult } from '../engine/run-result.ts';
import { resultWithResolvedTimingCollection, type RunTimingMeasurement } from './run-timing-collection.ts';
import { currentReplay } from './replay-context.ts';
import type { ResolvedRun } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { persistPropertyCorpus } from './property-corpus-execution.ts';
import { finalizeRuntimeAttachments } from './attachment-coordinator-context.ts';
import {
    readDurationHistoryIndex
} from './duration-history.ts';

export async function finalizeRunEvidence(
    resolvedRun: ResolvedRun,
    result: RunResult,
    timing: RunTimingMeasurement | null
): Promise<RunResult> {
    const attachmentResult = await persistPropertyCorpus(resolvedRun, await finalizeRuntimeAttachments(result));
    return resultWithResolvedTimingCollection(resolvedRun, attachmentResult, timing);
}

export async function readRunDurationHistory(
    dependencies: RunOrchestratorDependencies,
    projectRoot: string,
    runtimeStateDir: string
): ReturnType<typeof readDurationHistoryIndex> {
    if (currentReplay()?.kind === 'record') {
        return null;
    }
    return await readDurationHistoryIndex(dependencies.runtimeStateStore, projectRoot, runtimeStateDir);
}

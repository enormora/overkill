import type { RunResult } from '../engine/run-result.ts';
import { currentReplay } from './replay-context.ts';
import type { ResolvedRun } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { persistPropertyCorpus } from './property-corpus-execution.ts';
import { finalizeRuntimeAttachments } from './attachment-coordinator-context.ts';
import { withBenchmarkRunMetadata } from './benchmark-report-metadata.ts';
import {
    readDurationHistoryIndex,
    resultWithUpdatedDurationHistoryAndTiming,
    type DurationHistoryTimingMeasurement
} from './duration-history.ts';

export async function finalizeResultWithDurationHistory(
    dependencies: RunOrchestratorDependencies,
    resolvedRun: ResolvedRun,
    result: RunResult,
    timing: DurationHistoryTimingMeasurement | null = null
): Promise<RunResult> {
    let attachmentResult = await persistPropertyCorpus(resolvedRun, await finalizeRuntimeAttachments(result));
    if (resolvedRun.facts.execution.testFamily === 'benchmark') {
        attachmentResult = withBenchmarkRunMetadata(
            attachmentResult,
            resolvedRun.facts,
            Number(dependencies.wallClock.currentMonotonicMicroseconds)
        );
    }
    return await resultWithUpdatedDurationHistoryAndTiming({
        createHistoryStorage: dependencies.createHistoryStorage,
        completedAtMilliseconds: dependencies.wallClock.currentUnixEpochMilliseconds,
        resolvedRun,
        result: attachmentResult,
        store: dependencies.runtimeStateStore,
        timing
    });
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

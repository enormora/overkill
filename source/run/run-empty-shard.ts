import {
    createRunResultFromCollectedPlan
} from './collected-run-plan.ts';
import {
    createReporterDelivery
} from './supervised-run-runtime.ts';
import type {
    CollectedRunPlan,
    ResolvedRun,
    RunOrchestrator
} from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { ResolvedRunResultFinalizer, RunRuntimePolicy } from './run-support.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;

function currentRunStartTime(dependencies: RunOrchestratorDependencies): string {
    const startedAt = new Date(dependencies.wallClock.currentUnixEpochMilliseconds);

    return startedAt.toISOString();
}

function emptyShardCollectedPlan(resolvedRun: ResolvedRun): CollectedRunPlan {
    if (resolvedRun.plan.kind !== 'empty-shard') {
        throw new Error('Empty shard execution requires an empty-shard collected plan.');
    }

    return resolvedRun.plan.collectedPlan;
}

export async function executeEmptyShardRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    finalizeResult: ResolvedRunResultFinalizer,
    runtimePolicy: RunRuntimePolicy | null
): Promise<RunResult> {
    const collectedPlan = emptyShardCollectedPlan(resolvedRun);
    const reporterDelivery = await createReporterDelivery(resolvedRun, dependencies);
    const startedAtMicroseconds = Number(dependencies.wallClock.currentMonotonicMicroseconds);
    const runStartErrors = await reporterDelivery.reportEvent({
        facts: resolvedRun.facts,
        kind: 'run-start',
        root: {
            annotations: collectedPlan.root.annotations,
            title: collectedPlan.root.title
        },
        startedAt: currentRunStartTime(dependencies)
    });
    const timedResult = await finalizeResult(
        resolvedRun,
        createRunResultFromCollectedPlan(
            collectedPlan,
            [],
            [ ...resolvedRun.collectionRunnerErrors, ...runStartErrors, ...runtimePolicy?.takeRunErrors() ?? [] ],
            {
                completedAtMicroseconds: Number(dependencies.wallClock.currentMonotonicMicroseconds),
                planStatus: 'empty-shard',
                resourceUsage: null,
                startedAtMicroseconds,
                testExecutionWallTimeMicroseconds: 0
            }
        )
    );
    const runEndErrors = await reporterDelivery.reportEvent({ kind: 'run-end', result: timedResult });
    const resultForFinalReporting = {
        ...timedResult,
        runnerErrors: [ ...timedResult.runnerErrors, ...runEndErrors ]
    };
    const finalReporterErrors = await reporterDelivery.reportResult(resultForFinalReporting);
    const disposeErrors = await reporterDelivery.disposeReporters();

    return {
        ...resultForFinalReporting,
        runnerErrors: [ ...resultForFinalReporting.runnerErrors, ...finalReporterErrors, ...disposeErrors ]
    };
}

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
import type { RunRuntimePolicy } from './run-support.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;

function currentRunStartTime(dependencies: RunOrchestratorDependencies): string {
    const startedAt = new Date(dependencies.wallClock.currentTimestampInMilliseconds);

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
    runtimePolicy: RunRuntimePolicy | null
): Promise<RunResult> {
    const collectedPlan = emptyShardCollectedPlan(resolvedRun);
    const reporterDelivery = await createReporterDelivery(resolvedRun, dependencies);
    const startedAtMs = dependencies.wallClock.currentTimestampInMilliseconds;
    const runStartErrors = await reporterDelivery.reportEvent({
        facts: resolvedRun.facts,
        kind: 'run-start',
        root: {
            annotations: collectedPlan.root.annotations,
            title: collectedPlan.root.title
        },
        startedAt: currentRunStartTime(dependencies)
    });
    const result = createRunResultFromCollectedPlan(
        collectedPlan,
        [],
        [ ...resolvedRun.collectionRunnerErrors, ...runStartErrors, ...runtimePolicy?.takeRunErrors() ?? [] ],
        {
            planStatus: 'empty-shard',
            resourceUsage: null,
            startedAtMs,
            wallClock: dependencies.wallClock
        }
    );
    const runEndErrors = await reporterDelivery.reportEvent({ kind: 'run-end', result });
    const resultForFinalReporting = {
        ...result,
        runnerErrors: [ ...result.runnerErrors, ...runEndErrors ]
    };
    const finalReporterErrors = await reporterDelivery.reportResult(resultForFinalReporting);
    const disposeErrors = await reporterDelivery.disposeReporters();

    return {
        ...resultForFinalReporting,
        runnerErrors: [ ...resultForFinalReporting.runnerErrors, ...finalReporterErrors, ...disposeErrors ]
    };
}

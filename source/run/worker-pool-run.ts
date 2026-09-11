import type { RunResult } from '../packages/engine/engine.entry-point.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    createSupervisedRunState,
    type SupervisedRunState
} from './supervised-run-state.ts';
import type {
    ResolvedRun
} from './run-types.ts';
import { collectInWorkerPool } from './worker-pool-collection.ts';
import {
    executeWorkerPoolUnits,
    reportRunStart,
    startPoolResourceTracking
} from './worker-pool-execution.ts';
import type { WorkerPoolCommand } from './worker-pool-protocol.ts';
import {
    createEmptyWorkerPoolResult,
    finishWorkerPoolRun
} from './worker-pool-results.ts';
import {
    createWorkerPoolRuntime,
    fileUnits,
    workerPoolCollectedPlan,
    type WorkerPoolCollectionResult
} from './worker-pool-runtime.ts';

export async function collectWorkerPoolRun(
    command: WorkerPoolCommand,
    dependencies: RunOrchestratorDependencies
): Promise<WorkerPoolCollectionResult> {
    return await collectInWorkerPool(command, dependencies, createSupervisedRunState());
}

async function executeWorkerPoolRunWithState(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    collectionRunState: SupervisedRunState
): Promise<RunResult> {
    if (fileUnits(workerPoolCollectedPlan(resolvedRun)).length === 0) {
        return await createEmptyWorkerPoolResult(resolvedRun, dependencies, collectionRunState);
    }

    const runtime = await createWorkerPoolRuntime(
        resolvedRun,
        dependencies,
        resolvedRun.collectionRunnerErrors,
        collectionRunState
    );
    const startedAtMilliseconds = dependencies.wallClock.currentTimestampInMilliseconds;

    try {
        await reportRunStart(runtime, startedAtMilliseconds);
        startPoolResourceTracking(runtime);
        const completedTaskRuns = await executeWorkerPoolUnits(
            runtime,
            fileUnits(runtime.collectedPlan),
            startedAtMilliseconds
        );

        return await finishWorkerPoolRun(runtime, completedTaskRuns, startedAtMilliseconds);
    } finally {
        await runtime.pool.destroy();
    }
}

export async function executeWorkerPoolRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies
): Promise<RunResult> {
    return await executeWorkerPoolRunWithState(resolvedRun, dependencies, createSupervisedRunState());
}

export async function runWorkerPoolCommand(
    command: WorkerPoolCommand,
    dependencies: RunOrchestratorDependencies,
    createResolvedRun: (collection: WorkerPoolCollectionResult) => ResolvedRun
): Promise<RunResult> {
    const collectionRunState = createSupervisedRunState();
    const collection = await collectInWorkerPool(command, dependencies, collectionRunState);

    return await executeWorkerPoolRunWithState(createResolvedRun(collection), dependencies, collectionRunState);
}

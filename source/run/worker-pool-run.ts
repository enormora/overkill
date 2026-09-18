import type { RunResult } from '../packages/engine/engine.entry-point.ts';
import type {
    CreatedWorkerPool,
    RunOrchestratorDependencies
} from './run-orchestrator-dependencies.ts';
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
    workerPoolPlacementPlan,
    type WorkerPoolCollectionResult
} from './worker-pool-runtime.ts';

type RunResultFinalizer = (resolvedRun: ResolvedRun, result: RunResult) => Promise<RunResult>;

type WorkerPoolExecutionOptions = {
    readonly finalizeResult: RunResultFinalizer;
};

type WorkerPoolExecutionState = WorkerPoolExecutionOptions & {
    readonly collectionRunState: SupervisedRunState;
    readonly createdPool: CreatedWorkerPool | null;
};

export async function collectWorkerPoolRun(
    command: WorkerPoolCommand,
    dependencies: RunOrchestratorDependencies
): Promise<WorkerPoolCollectionResult> {
    return await collectInWorkerPool(command, dependencies, createSupervisedRunState());
}

async function releaseRuntimePool(
    runtime: Awaited<ReturnType<typeof createWorkerPoolRuntime>>
): Promise<void> {
    runtime.pool.setHostOutputSink?.(null);

    if (runtime.destroyPool) {
        await runtime.pool.destroy();
    }
}

async function finishExecution(
    runtime: Awaited<ReturnType<typeof createWorkerPoolRuntime>>,
    resolvedRun: ResolvedRun,
    startedAtMilliseconds: number
): Promise<RunResult> {
    await reportRunStart(runtime, startedAtMilliseconds);
    await startPoolResourceTracking(runtime);

    return await finishWorkerPoolRun(
        runtime,
        await executeWorkerPoolUnits(runtime, workerPoolPlacementPlan(resolvedRun), startedAtMilliseconds),
        startedAtMilliseconds
    );
}

async function executeWorkerPoolRunWithState(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    state: WorkerPoolExecutionState
): Promise<RunResult> {
    if (workerPoolPlacementPlan(resolvedRun).units.length === 0) {
        return await createEmptyWorkerPoolResult(resolvedRun, dependencies, state.collectionRunState);
    }

    const runtime = await createWorkerPoolRuntime({
        collectionRunnerErrors: resolvedRun.collectionRunnerErrors,
        createdPool: state.createdPool,
        dependencies,
        async finalizeResult(result: RunResult): Promise<RunResult> {
            return await state.finalizeResult(resolvedRun, result);
        },
        resolvedRun,
        runState: state.collectionRunState
    });
    const startedAtMilliseconds = dependencies.wallClock.currentTimestampInMilliseconds;

    try {
        return await finishExecution(runtime, resolvedRun, startedAtMilliseconds);
    } finally {
        await releaseRuntimePool(runtime);
    }
}

export async function executeWorkerPoolRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    options: WorkerPoolExecutionOptions
): Promise<RunResult> {
    return await executeWorkerPoolRunWithState(resolvedRun, dependencies, {
        ...options,
        collectionRunState: createSupervisedRunState(),
        createdPool: null
    });
}

export async function runWorkerPoolCommand(
    command: WorkerPoolCommand,
    dependencies: RunOrchestratorDependencies,
    createResolvedRun: (collection: WorkerPoolCollectionResult) => Promise<ResolvedRun>,
    options: WorkerPoolExecutionOptions
): Promise<RunResult> {
    const collectionRunState = createSupervisedRunState();
    const pool = command.hostProcess.kind === 'child'
        ? dependencies.createWorkerPool({
            cwd: command.cwd,
            hostProcess: command.hostProcess,
            workerCount: dependencies.availableParallelism,
            workerLifecycle: command.workerLifecycle
        })
        : null;

    try {
        const collection = await collectInWorkerPool(command, dependencies, collectionRunState, pool);

        return await executeWorkerPoolRunWithState(
            await createResolvedRun(collection),
            dependencies,
            {
                ...options,
                collectionRunState,
                createdPool: pool
            }
        );
    } finally {
        await pool?.destroy();
    }
}

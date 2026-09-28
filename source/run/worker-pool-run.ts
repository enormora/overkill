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
    executeWorkerPoolUnits
} from './worker-pool-execution.ts';
import {
    reportRunStart,
    startPoolResourceTracking
} from './worker-pool-resource-tracking.ts';
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
import {
    emptyTimingSpanMetadata,
    type RunTimingMeasurement
} from './run-timing-collection.ts';

type RunResultFinalizer = (resolvedRun: ResolvedRun, result: RunResult) => Promise<RunResult>;

type WorkerPoolExecutionOptions = {
    readonly finalizeResult: RunResultFinalizer;
    readonly timing: RunTimingMeasurement | null;
};

type WorkerPoolExecutionState = WorkerPoolExecutionOptions & {
    readonly collectionRunState: SupervisedRunState;
    readonly createdPool: CreatedWorkerPool | null;
};

export async function collectWorkerPoolRun(
    command: WorkerPoolCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement | null = null
): Promise<WorkerPoolCollectionResult> {
    return await collectInWorkerPool(command, dependencies, createSupervisedRunState(), null, timing);
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
    startedAtMilliseconds: number,
    startedAtMicroseconds: number
): Promise<RunResult> {
    await reportRunStart(runtime, startedAtMilliseconds);
    await startPoolResourceTracking(runtime);

    return await finishWorkerPoolRun(
        runtime,
        await executeWorkerPoolUnits(runtime, workerPoolPlacementPlan(resolvedRun), startedAtMilliseconds),
        startedAtMicroseconds
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
        runState: state.collectionRunState,
        timing: state.timing
    });
    const startedAtMilliseconds = dependencies.wallClock.currentEpochMilliseconds;
    const startedAtMicroseconds = dependencies.wallClock.currentMonotonicMicroseconds;

    try {
        state.timing?.record(
            'worker-pool.ready',
            'success',
            dependencies.wallClock.currentMonotonicMicroseconds,
            dependencies.wallClock.currentMonotonicMicroseconds,
            emptyTimingSpanMetadata()
        );

        return await finishExecution(runtime, resolvedRun, startedAtMilliseconds, startedAtMicroseconds);
    } finally {
        if (runtime.destroyPool) {
            await (state.timing?.measureAsync(
                'worker-pool.shutdown',
                emptyTimingSpanMetadata(),
                async function releaseTimedWorkerPoolRuntime() {
                    await releaseRuntimePool(runtime);
                }
            ) ?? releaseRuntimePool(runtime));
        } else {
            await releaseRuntimePool(runtime);
        }
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
    const poolOptions = {
        cwd: command.cwd,
        hostProcess: command.hostProcess,
        testFamily: command.testFamily,
        ...(options.timing === null ? {} : { timing: options.timing }),
        workerCount: dependencies.availableParallelism,
        workerLifecycle: command.workerLifecycle
    };
    const pool = command.hostProcess.kind === 'child'
        ? options.timing?.measure(
            'worker-pool.start',
            emptyTimingSpanMetadata(),
            function createTimedHostedWorkerPool() {
                return dependencies.createWorkerPool(poolOptions);
            }
        ) ?? dependencies.createWorkerPool(poolOptions)
        : null;

    try {
        const collection = await collectInWorkerPool(command, dependencies, collectionRunState, pool, options.timing);

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
        if (pool !== null) {
            await (options.timing?.measureAsync(
                'worker-pool.shutdown',
                emptyTimingSpanMetadata(),
                async function destroyTimedCollectionWorkerPool() {
                    await pool.destroy();
                }
            ) ?? pool.destroy());
        }
    }
}

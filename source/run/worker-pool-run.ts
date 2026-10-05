import { activeRuntimeAttachments, executeWithRuntimeAttachments } from './runtime-attachment-boundary.ts';
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
    createWorkerPoolPlacementTraceRecorder,
    workerPoolPlacementPlan,
    type WorkerPoolCollectionResult,
    type WorkerPoolRunCompletion,
    type WorkerPoolRuntimeInput
} from './worker-pool-runtime.ts';

type RunResult = WorkerPoolRunCompletion['result'];

type RunResultFinalizer = (resolvedRun: ResolvedRun, completion: WorkerPoolRunCompletion) => Promise<RunResult>;
type RunTimingMeasurement = NonNullable<NonNullable<WorkerPoolRuntimeInput['timing']>>;
const emptyWorkerPoolTimingMetadata = Object.freeze({
    label: null,
    processId: null,
    resource: null,
    workerId: null
});

type WorkerPoolExecutionOptions = {
    readonly finalizeResult: RunResultFinalizer;
    readonly timing: RunTimingMeasurement | null;
};

type WorkerPoolExecutionState = WorkerPoolExecutionOptions & {
    readonly collectionRunState: SupervisedRunState;
    readonly createdPool: CreatedWorkerPool | null;
};

type WorkerPoolRunRuntime = Awaited<ReturnType<typeof createWorkerPoolRuntime>>;

export async function collectWorkerPoolRun(
    command: WorkerPoolCommand,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement | null = null
): Promise<WorkerPoolCollectionResult> {
    return await collectInWorkerPool({
        command,
        createdPool: null,
        dependencies,
        runState: createSupervisedRunState('first-failure-and-final'),
        timing
    });
}

async function releaseRuntimePool(
    runtime: WorkerPoolRunRuntime
): Promise<void> {
    runtime.pool.setHostOutputSink?.(null);

    if (runtime.destroyPool) {
        await runtime.pool.destroy();
    }
}

async function releaseTimedRuntimePool(
    runtime: WorkerPoolRunRuntime,
    timing: RunTimingMeasurement | null
): Promise<void> {
    if (runtime.destroyPool) {
        await (timing?.measureAsync(
            'worker-pool.shutdown',
            emptyWorkerPoolTimingMetadata,
            async function releaseTimedWorkerPoolRuntime() {
                await releaseRuntimePool(runtime);
            }
        ) ?? releaseRuntimePool(runtime));
    } else {
        await releaseRuntimePool(runtime);
    }
}

async function finishExecution(
    runtime: WorkerPoolRunRuntime,
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

async function createRuntime(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    state: WorkerPoolExecutionState
): Promise<WorkerPoolRunRuntime> {
    return await createWorkerPoolRuntime({
        attachments: activeRuntimeAttachments(),
        collectionRunnerErrors: resolvedRun.collectionRunnerErrors,
        createdPool: state.createdPool,
        dependencies,
        async finalizeResult(completion): Promise<RunResult> {
            return await state.finalizeResult(resolvedRun, completion);
        },
        resolvedRun,
        runState: state.collectionRunState,
        timing: state.timing
    });
}

async function finishExecutionWithRuntime(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    state: WorkerPoolExecutionState,
    runtime: WorkerPoolRunRuntime
): Promise<RunResult> {
    const startedAtMilliseconds = dependencies.wallClock.currentUnixEpochMilliseconds;
    const startedAtMicroseconds = Number(dependencies.wallClock.currentMonotonicMicroseconds);
    const readyAtMicroseconds = Number(dependencies.wallClock.currentMonotonicMicroseconds);

    state.timing?.record({
        completedAtMicroseconds: readyAtMicroseconds,
        kind: 'worker-pool.ready',
        metadata: emptyWorkerPoolTimingMetadata,
        startedAtMicroseconds: readyAtMicroseconds,
        status: 'success'
    });

    return await finishExecution(runtime, resolvedRun, startedAtMilliseconds, startedAtMicroseconds);
}

async function executeWorkerPoolRunWithoutAttachments(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    state: WorkerPoolExecutionState
): Promise<RunResult> {
    if (workerPoolPlacementPlan(resolvedRun).units.length === 0) {
        const result = await createEmptyWorkerPoolResult(resolvedRun, dependencies, state.collectionRunState);
        return await state.finalizeResult(resolvedRun, {
            placementTrace: createWorkerPoolPlacementTraceRecorder().finish(),
            result
        });
    }

    const runtime = await createRuntime(resolvedRun, dependencies, state);

    try {
        return await finishExecutionWithRuntime(resolvedRun, dependencies, state, runtime);
    } finally {
        await releaseTimedRuntimePool(runtime, state.timing);
    }
}

async function executeWorkerPoolRunWithState(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    state: WorkerPoolExecutionState
): Promise<RunResult> {
    return await executeWithRuntimeAttachments(resolvedRun, dependencies, async function executeAttachmentWorkers() {
        return await executeWorkerPoolRunWithoutAttachments(resolvedRun, dependencies, state);
    });
}

export async function executeWorkerPoolRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    options: WorkerPoolExecutionOptions
): Promise<RunResult> {
    return await executeWorkerPoolRunWithState(resolvedRun, dependencies, {
        ...options,
        collectionRunState: createSupervisedRunState('first-failure-and-final'),
        createdPool: null
    });
}

async function destroyCommandPool(
    pool: CreatedWorkerPool | null,
    timing: RunTimingMeasurement | null
): Promise<void> {
    if (pool !== null) {
        await (timing?.measureAsync(
            'worker-pool.shutdown',
            emptyWorkerPoolTimingMetadata,
            async function destroyTimedCollectionWorkerPool() {
                await pool.destroy();
            }
        ) ?? pool.destroy());
    }
}

export async function runWorkerPoolCommand(
    command: WorkerPoolCommand,
    dependencies: RunOrchestratorDependencies,
    createResolvedRun: (collection: WorkerPoolCollectionResult) => Promise<ResolvedRun>,
    options: WorkerPoolExecutionOptions
): Promise<RunResult> {
    const collectionRunState = createSupervisedRunState('first-failure-and-final');
    const timingOption = options.timing === null ? {} : { timing: options.timing };
    const poolOptions = {
        cwd: command.cwd,
        hostProcess: command.hostProcess,
        testFamily: command.testFamily,
        ...timingOption,
        workerCount: 1,
        workerLifecycle: command.workerLifecycle
    };
    const pool = command.hostProcess.kind === 'child'
        ? options.timing?.measure(
            'worker-pool.start',
            emptyWorkerPoolTimingMetadata,
            function createTimedHostedWorkerPool() {
                return dependencies.createWorkerPool(poolOptions);
            }
        ) ?? dependencies.createWorkerPool(poolOptions)
        : null;

    try {
        const collection = await collectInWorkerPool({
            command,
            createdPool: pool,
            dependencies,
            runState: collectionRunState,
            timing: options.timing
        });

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
        await destroyCommandPool(pool, options.timing);
    }
}

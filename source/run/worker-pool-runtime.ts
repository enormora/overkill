import type {
    ResourceUsageSnapshot,
    RunResult,
    RunnerError
} from '../packages/engine/engine.entry-point.ts';
import type {
    CollectedRunPlan,
    PlacementPlan,
    RunExecutionFacts,
    ResolvedRun,
    WorkUnit
} from './run-types.ts';
import type {
    RunOrchestratorDependencies,
    WorkerPoolResourceUsageTracker,
    WorkerPoolCreationOptions
} from './run-orchestrator-dependencies.ts';
import {
    createReporterDelivery,
    createReporterEventQueue,
    type ReporterEventQueue
} from './supervised-run-runtime.ts';
import {
    createStoredRunValue,
    type StoredRunValue,
    type SupervisedRunState
} from './supervised-run-state.ts';
import {
    loadTinypoolConstructor,
    type TinypoolInstance,
    type TinypoolNodeCompatibility
} from './tinypool-node-compatibility.ts';
import { runTask as workerPoolWorkerEntryPoint } from './worker-pool-worker.ts';

const Tinypool = loadTinypoolConstructor();

export type WorkerPoolCollectionResult = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly RunnerError[];
};

type WorkerPoolTaskRuns = {
    readonly add: (taskRun: WorkerPoolTaskRun) => WorkerPoolTaskRuns;
    readonly delete: (taskRun: WorkerPoolTaskRun) => boolean;
    readonly [Symbol.iterator]: () => SetIterator<WorkerPoolTaskRun>;
    readonly size: number;
};

type WorkerPoolTaskResultList = {
    readonly flatMap: (readonly RunResult[])['flatMap'];
    readonly push: (...results: readonly RunResult[]) => number;
};

type WorkerPoolStartedCaseSet = {
    readonly add: (caseKey: string) => WorkerPoolStartedCaseSet;
    readonly has: (caseKey: string) => boolean;
};

export type WorkerPoolTaskRun = {
    readonly controller: AbortController;
    readonly endedByParent: StoredRunValue<boolean>;
    readonly requeuePendingCases: StoredRunValue<boolean>;
    readonly state: SupervisedRunState;
    readonly startedCases: WorkerPoolStartedCaseSet;
    readonly timeout: StoredRunValue<ReturnType<RunOrchestratorDependencies['wallClock']['setTimeout']> | null>;
    readonly unit: WorkUnit;
};

export type WorkerPoolRunRuntime = {
    readonly activeTasks: WorkerPoolTaskRuns;
    readonly collectedPlan: CollectedRunPlan;
    readonly collectionRunnerErrors: readonly RunnerError[];
    readonly dependencies: RunOrchestratorDependencies;
    readonly pool: TinypoolInstance;
    readonly poolResourceUsageTracker: WorkerPoolResourceUsageTracker | null;
    readonly previousPoolSample: StoredRunValue<ResourceUsageSnapshot | null>;
    readonly reporterDelivery: Awaited<ReturnType<typeof createReporterDelivery>>;
    readonly reporterEvents: ReporterEventQueue;
    readonly resolvedRun: ResolvedRun;
    readonly runState: SupervisedRunState;
    readonly taskResults: WorkerPoolTaskResultList;
    readonly terminalFailure: StoredRunValue<boolean>;
};

type WorkerPoolRuntimeInput = {
    readonly collectionRunnerErrors: readonly RunnerError[];
    readonly createdPool: TinypoolInstance | null;
    readonly dependencies: RunOrchestratorDependencies;
    readonly resolvedRun: ResolvedRun;
    readonly runState: SupervisedRunState;
};

type WorkerPoolEntryPointToken = {
    readonly compatibility: TinypoolNodeCompatibility | null;
    readonly worker: typeof workerPoolWorkerEntryPoint;
};

function workerPoolEntryPointHref(entryPoint: WorkerPoolEntryPointToken): string {
    const entryPointWorkerName = entryPoint.worker.name;
    const workerPoolEntryPointUrl = new URL('./worker-pool-worker.ts', import.meta.url);

    return workerPoolEntryPointUrl.href + entryPointWorkerName.slice(0, 0);
}

export const workerPoolEntryPoint = workerPoolEntryPointHref({
    compatibility: null,
    worker: workerPoolWorkerEntryPoint
});

export function runStartTimeFromMilliseconds(milliseconds: number): string {
    const startedAt = new Date(milliseconds);

    return startedAt.toISOString();
}

type TinypoolWorkerPoolOptions = WorkerPoolCreationOptions & {
    readonly filename: string;
};

type WorkerPoolExecutionFacts = Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>;

function isolateWorkers(options: TinypoolWorkerPoolOptions): boolean {
    return options.workerLifecycle === 'fresh-worker-per-unit';
}

export function createTinypoolWorkerPool(options: TinypoolWorkerPoolOptions): TinypoolInstance {
    return new Tinypool({
        concurrentTasksPerWorker: 1,
        filename: options.filename,
        isolateWorkers: isolateWorkers(options),
        maxThreads: options.workerCount,
        minThreads: options.workerCount,
        runtime: 'worker_threads'
    });
}

export function createPool(options: WorkerPoolCreationOptions): TinypoolInstance {
    return createTinypoolWorkerPool({
        ...options,
        filename: workerPoolEntryPoint
    });
}

export function workerPoolCollectedPlan(resolvedRun: ResolvedRun): CollectedRunPlan {
    if (resolvedRun.plan.kind !== 'worker-pool') {
        throw new Error('Worker-pool execution requires a worker-pool collected plan.');
    }

    return resolvedRun.plan.collectedPlan;
}

function createPoolResourceUsageTracker(
    pool: TinypoolInstance,
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies
): WorkerPoolResourceUsageTracker | null {
    if (!resolvedRun.facts.execution.resourceUsagePolicy.measure) {
        return null;
    }

    if (pool.createResourceUsageTracker !== undefined) {
        return pool.createResourceUsageTracker({
            samplingIntervalMilliseconds: resolvedRun.facts.execution.resourceUsagePolicy.samplingIntervalMilliseconds
        });
    }

    return dependencies.createResourceUsageTracker({
        samplingIntervalMilliseconds: resolvedRun.facts.execution.resourceUsagePolicy.samplingIntervalMilliseconds
    });
}

export function workerPoolExecutionFacts(resolvedRun: ResolvedRun): WorkerPoolExecutionFacts {
    if (resolvedRun.facts.execution.processModel !== 'worker-pool') {
        throw new Error('Worker-pool execution requires worker-pool execution facts.');
    }

    return resolvedRun.facts.execution;
}

export function workerPoolPlacementPlan(resolvedRun: ResolvedRun): PlacementPlan {
    const { placementPlan } = workerPoolExecutionFacts(resolvedRun);

    if (placementPlan === null) {
        throw new Error('Worker-pool execution requires a placement plan.');
    }

    return placementPlan;
}

export async function createWorkerPoolRuntime(
    input: WorkerPoolRuntimeInput
): Promise<WorkerPoolRunRuntime> {
    const { collectionRunnerErrors, createdPool, dependencies, resolvedRun, runState } = input;
    const placementPlan = workerPoolPlacementPlan(resolvedRun);
    const execution = workerPoolExecutionFacts(resolvedRun);
    const taskResults: RunResult[] = [];
    const pool = createdPool ?? dependencies.createWorkerPool({
        cwd: resolvedRun.cwd,
        hostProcess: execution.hostProcess.kind === 'direct'
            ? { kind: 'direct' }
            : {
                kind: 'child',
                nodeArguments: Array.from(execution.hostProcess.nodeArguments)
            },
        workerCount: placementPlan.lanes.length,
        workerLifecycle: execution.workerLifecycle
    });
    pool.setHostOutputSink?.(function recordHostOutput(stream, chunk) {
        if (execution.capture === 'live') {
            dependencies.liveOutput[stream].write(chunk);

            return;
        }

        runState.recordCapturedOutput(stream, chunk, dependencies.wallClock.currentTimestampInMilliseconds);
    });

    return {
        activeTasks: new Set(),
        collectedPlan: workerPoolCollectedPlan(resolvedRun),
        collectionRunnerErrors,
        dependencies,
        pool,
        poolResourceUsageTracker: createPoolResourceUsageTracker(pool, resolvedRun, dependencies),
        previousPoolSample: createStoredRunValue<ResourceUsageSnapshot | null>(null),
        reporterDelivery: await createReporterDelivery(resolvedRun, dependencies),
        reporterEvents: createReporterEventQueue(),
        resolvedRun,
        runState,
        taskResults,
        terminalFailure: createStoredRunValue(false)
    };
}

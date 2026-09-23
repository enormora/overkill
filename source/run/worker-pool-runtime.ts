import type {
    ReporterEvent,
    ResourceUsageSnapshot,
    RunResult,
    RunnerError
} from '../packages/engine/engine.entry-point.ts';
import type {
    CollectedRunPlan,
    PlacementPlan,
    RunExecutionFacts,
    ResolvedRun,
    RunHostProcess,
    RunWorkerLifecycle,
    WorkUnit
} from './run-types.ts';
import type { PlacementTraceEntry, TraceWorkUnitId } from './placement-trace.ts';
import type {
    CreatedWorkerPool,
    RunOrchestratorDependencies,
    WorkerPoolResourceUsageTracker,
    WorkerPoolCreationOptions
} from './run-orchestrator-dependencies.ts';
import { createReporterDelivery, createReporterEventQueue, type ReporterEventQueue } from './supervised-run-runtime.ts';
import { createStoredRunValue, type StoredRunValue, type SupervisedRunState } from './supervised-run-state.ts';
import { loadTinypoolConstructor, type TinypoolInstance } from './tinypool-node-compatibility.ts';
import { runTask as workerPoolWorkerEntryPoint } from './worker-pool-worker.ts';
import { createRoutedPool } from './worker-pool-routing.ts';

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
    readonly size: number;
};

type WorkerPoolReporterEventBuffer = {
    readonly [Symbol.iterator]: () => IterableIterator<ReporterEvent>;
    readonly clear: () => void;
    readonly push: (...events: readonly ReporterEvent[]) => number;
};

type WorkerPoolTaskRunMember = {
    readonly traceUnit: TraceWorkUnitId;
    readonly unit: WorkUnit;
};

export type WorkerPoolTaskRun = {
    readonly activeTraceUnit: StoredRunValue<TraceWorkUnitId | null>;
    readonly bufferedReporterEvents: WorkerPoolReporterEventBuffer;
    readonly controller: AbortController;
    readonly endedByParent: StoredRunValue<boolean>;
    readonly envelopeId: StoredRunValue<string | null>;
    readonly includeArtifacts: StoredRunValue<boolean>;
    readonly leaseKind: 'hedged-duplicate' | 'primary';
    readonly lane: string;
    readonly members: readonly [WorkerPoolTaskRunMember, ...(readonly WorkerPoolTaskRunMember[])];
    readonly reporterEventsBuffered: boolean;
    readonly requeuePendingCases: StoredRunValue<boolean>;
    readonly state: SupervisedRunState;
    readonly startedCases: WorkerPoolStartedCaseSet;
    readonly timeout: StoredRunValue<ReturnType<RunOrchestratorDependencies['wallClock']['setTimeout']> | null>;
    readonly traceUnit: TraceWorkUnitId;
    readonly unit: WorkUnit;
};

export type WorkerPoolRunRuntime = {
    readonly activeTasks: WorkerPoolTaskRuns;
    readonly collectedPlan: CollectedRunPlan;
    readonly collectionRunnerErrors: readonly RunnerError[];
    readonly dependencies: RunOrchestratorDependencies;
    readonly destroyPool: boolean;
    readonly finalizeResult: (result: RunResult) => Promise<RunResult>;
    readonly pool: CreatedWorkerPool;
    readonly poolResourceUsageTracker: WorkerPoolResourceUsageTracker | null;
    readonly placementTraceEntries: readonly PlacementTraceEntry[];
    readonly previousPoolSample: StoredRunValue<ResourceUsageSnapshot | null>;
    readonly recordPlacementTraceEntry: (entry: PlacementTraceEntry) => void;
    readonly reporterDelivery: Awaited<ReturnType<typeof createReporterDelivery>>;
    readonly reporterEvents: ReporterEventQueue;
    readonly resolvedRun: ResolvedRun;
    readonly runState: SupervisedRunState;
    readonly taskResults: WorkerPoolTaskResultList;
    readonly terminalFailure: StoredRunValue<boolean>;
};

type WorkerPoolRuntimeInput = {
    readonly collectionRunnerErrors: readonly RunnerError[];
    readonly createdPool: CreatedWorkerPool | null;
    readonly dependencies: RunOrchestratorDependencies;
    readonly finalizeResult: (result: RunResult) => Promise<RunResult>;
    readonly resolvedRun: ResolvedRun;
    readonly runState: SupervisedRunState;
};

type WorkerPoolExecutionPool = {
    readonly destroyPool: boolean;
    readonly pool: CreatedWorkerPool;
};

function workerPoolEntryPointHref(worker: typeof workerPoolWorkerEntryPoint): string {
    const entryPointWorkerName = worker.name;
    const workerPoolEntryPointUrl = new URL('./worker-pool-worker.ts', import.meta.url);

    return workerPoolEntryPointUrl.href + entryPointWorkerName.slice(0, 0);
}

export const workerPoolEntryPoint = workerPoolEntryPointHref(workerPoolWorkerEntryPoint);

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

function copiedHostProcess(execution: WorkerPoolExecutionFacts): RunHostProcess {
    return execution.hostProcess.kind === 'direct'
        ? { kind: 'direct' }
        : {
            kind: 'child',
            nodeArguments: Array.from(execution.hostProcess.nodeArguments)
        };
}

export function workerPoolExecutionFacts(resolvedRun: ResolvedRun): WorkerPoolExecutionFacts {
    if (resolvedRun.facts.execution.processModel !== 'worker-pool') {
        throw new Error('Worker-pool execution requires worker-pool execution facts.');
    }

    return resolvedRun.facts.execution;
}

function unitsByKey(units: readonly WorkUnit[]): ReadonlyMap<string, WorkUnit> {
    return new Map(units.map(function toEntry(unit) {
        return [ JSON.stringify(unit.id), unit ];
    }));
}

function assignedUnits(plan: PlacementPlan): readonly WorkUnit[] {
    const units = unitsByKey(plan.units);

    return plan.assignments.map(function toUnit(assignment) {
        const unit = units.get(JSON.stringify(assignment.unit));

        if (unit === undefined) {
            throw new Error('Placement assignment referenced an unknown work unit.');
        }

        return unit;
    });
}

function laneLifecycle(
    laneLifecycles: ReadonlyMap<string, RunWorkerLifecycle>,
    lane: string,
    workerLifecycle: RunWorkerLifecycle
): RunWorkerLifecycle {
    const existingLifecycle = laneLifecycles.get(lane);

    if (existingLifecycle !== undefined && existingLifecycle !== workerLifecycle) {
        throw new Error('Placement lane cannot mix worker lifecycle policies.');
    }

    return workerLifecycle;
}

function placementLaneLifecycles(plan: PlacementPlan): ReadonlyMap<string, RunWorkerLifecycle> {
    const laneLifecycles = new Map<string, RunWorkerLifecycle>();
    const units = assignedUnits(plan);

    plan.assignments.forEach(function recordLaneLifecycle(assignment, index) {
        const unit = units[index];

        if (unit === undefined) {
            throw new Error('Placement assignment referenced an unknown work unit.');
        }

        laneLifecycles.set(assignment.lane, laneLifecycle(laneLifecycles, assignment.lane, unit.workerLifecycle));
    });

    return laneLifecycles;
}

function workerPoolOptions(
    resolvedRun: ResolvedRun,
    execution: WorkerPoolExecutionFacts,
    workerCount: number,
    workerLifecycle: RunWorkerLifecycle
): WorkerPoolCreationOptions {
    return {
        cwd: resolvedRun.cwd,
        hostProcess: copiedHostProcess(execution),
        testFamily: execution.testFamily,
        workerCount,
        workerLifecycle
    };
}

function createEmptyExecutionPool(
    input: WorkerPoolRuntimeInput,
    execution: WorkerPoolExecutionFacts
): WorkerPoolExecutionPool {
    return {
        destroyPool: input.createdPool === null,
        pool: input.createdPool ?? input.dependencies.createWorkerPool(
            workerPoolOptions(input.resolvedRun, execution, 0, execution.workerLifecycle)
        )
    };
}

function createLaneExecutionPool(
    input: WorkerPoolRuntimeInput,
    execution: WorkerPoolExecutionFacts,
    placementPlan: PlacementPlan
): WorkerPoolExecutionPool {
    const laneLifecycles = placementLaneLifecycles(placementPlan);
    const singleLane = placementPlan.lanes[0];

    if (input.createdPool !== null && placementPlan.lanes.length === 1 && singleLane !== undefined) {
        return {
            destroyPool: false,
            pool: input.createdPool
        };
    }

    const routes = placementPlan.lanes.map(function toRoute(lane) {
        const workerLifecycle = laneLifecycles.get(lane.id);

        if (workerLifecycle === undefined) {
            throw new Error('Placement lane has no assigned worker lifecycle.');
        }

        return {
            pool: input.dependencies.createWorkerPool(workerPoolOptions(
                input.resolvedRun,
                execution,
                1,
                workerLifecycle
            )),
            lane: lane.id,
            workerLifecycle
        };
    });

    return {
        destroyPool: true,
        pool: createRoutedPool(routes)
    };
}

function createExecutionPool(input: WorkerPoolRuntimeInput, placementPlan: PlacementPlan): WorkerPoolExecutionPool {
    const execution = workerPoolExecutionFacts(input.resolvedRun);

    if (placementPlan.lanes.length === 0) {
        return createEmptyExecutionPool(input, execution);
    }

    return createLaneExecutionPool(input, execution, placementPlan);
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
    const { collectionRunnerErrors, dependencies, finalizeResult, resolvedRun, runState } = input;
    const placementPlan = workerPoolPlacementPlan(resolvedRun);
    const execution = workerPoolExecutionFacts(resolvedRun);
    const taskResults: RunResult[] = [];
    const executionPool = createExecutionPool(input, placementPlan);
    const { destroyPool, pool } = executionPool;
    const placementTraceEntries: PlacementTraceEntry[] = [];

    pool.setHostOutputSink?.(function recordHostOutput(stream, chunk) {
        if (execution.capture === 'live') {
            dependencies.liveOutput[stream].write(chunk);

            return;
        }

        runState.recordCapturedOutput(stream, chunk, dependencies.wallClock.currentMonotonicMicroseconds);
    });

    return {
        activeTasks: new Set(),
        collectedPlan: workerPoolCollectedPlan(resolvedRun),
        collectionRunnerErrors,
        dependencies,
        destroyPool,
        finalizeResult,
        pool,
        poolResourceUsageTracker: createPoolResourceUsageTracker(pool, resolvedRun, dependencies),
        placementTraceEntries,
        previousPoolSample: createStoredRunValue<ResourceUsageSnapshot | null>(null),
        recordPlacementTraceEntry(entry) {
            placementTraceEntries.push(entry);
        },
        reporterDelivery: await createReporterDelivery(resolvedRun, dependencies),
        reporterEvents: createReporterEventQueue(),
        resolvedRun,
        runState,
        taskResults,
        terminalFailure: createStoredRunValue(false)
    };
}

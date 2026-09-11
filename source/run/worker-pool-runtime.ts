import os from 'node:os';
import { createCaseId, type CaseId } from '../engine/identity.ts';
import type {
    ResourceUsageSnapshot,
    RunResult,
    RunnerError
} from '../packages/engine/engine.entry-point.ts';
import type {
    CollectedRunFile,
    CollectedRunPlan,
    RunExecutionFacts,
    ResolvedRun
} from './run-types.ts';
import type {
    RunOrchestratorDependencies,
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

export type WorkerPoolFileUnit = {
    readonly assignedCases: readonly CaseId[];
    readonly file: string;
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
    readonly unit: WorkerPoolFileUnit;
};

export type WorkerPoolRunRuntime = {
    readonly activeTasks: WorkerPoolTaskRuns;
    readonly collectedPlan: CollectedRunPlan;
    readonly collectionRunnerErrors: readonly RunnerError[];
    readonly dependencies: RunOrchestratorDependencies;
    readonly pool: TinypoolInstance;
    readonly poolResourceUsageTracker: RunResourceUsageTracker | null;
    readonly previousPoolSample: StoredRunValue<ResourceUsageSnapshot | null>;
    readonly reporterDelivery: Awaited<ReturnType<typeof createReporterDelivery>>;
    readonly reporterEvents: ReporterEventQueue;
    readonly resolvedRun: ResolvedRun;
    readonly runState: SupervisedRunState;
    readonly taskResults: WorkerPoolTaskResultList;
    readonly terminalFailure: StoredRunValue<boolean>;
};

type RunResourceUsageTracker = ReturnType<RunOrchestratorDependencies['createResourceUsageTracker']>;

const maximumWorkerCount = 8;
type WorkerPoolEntryPointToken = {
    readonly compatibility: TinypoolNodeCompatibility | null;
    readonly worker: typeof workerPoolWorkerEntryPoint;
};

function workerPoolEntryPointHref(entryPoint: WorkerPoolEntryPointToken): string {
    const entryPointWorkerName = entryPoint.worker.name;
    const workerPoolEntryPointUrl = new URL('./worker-pool-worker.ts', import.meta.url);

    return workerPoolEntryPointUrl.href + entryPointWorkerName.slice(0, 0);
}

const workerPoolEntryPoint = workerPoolEntryPointHref({
    compatibility: null,
    worker: workerPoolWorkerEntryPoint
});

export function runStartTimeFromMilliseconds(milliseconds: number): string {
    const startedAt = new Date(milliseconds);

    return startedAt.toISOString();
}

function defaultWorkerCount(unitCount: number): number {
    if (unitCount === 0) {
        return 0;
    }

    return Math.min(Math.max(os.availableParallelism() - 1, 1), maximumWorkerCount, unitCount);
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

function collectFileCaseIds(file: CollectedRunFile): readonly CaseId[] {
    return file.cases.map(function toCaseId(testCase) {
        return createCaseId(
            file.file,
            testCase.suitePath.map(function toSuiteTitle(entry) {
                return entry.title;
            }),
            testCase.title,
            testCase.params
        );
    });
}

export function fileUnits(collectedPlan: CollectedRunPlan): readonly WorkerPoolFileUnit[] {
    return collectedPlan.files.map(function toFileUnit(file) {
        return {
            assignedCases: collectFileCaseIds(file),
            file: file.file
        };
    });
}

function createPoolResourceUsageTracker(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies
): RunResourceUsageTracker | null {
    if (!resolvedRun.facts.execution.resourceUsagePolicy.measure) {
        return null;
    }

    return dependencies.createResourceUsageTracker({
        samplingIntervalMilliseconds: resolvedRun.facts.execution.resourceUsagePolicy.samplingIntervalMilliseconds
    });
}

function workerPoolExecutionFacts(resolvedRun: ResolvedRun): WorkerPoolExecutionFacts {
    if (resolvedRun.facts.execution.processModel !== 'worker-pool') {
        throw new Error('Worker-pool execution requires worker-pool execution facts.');
    }

    return resolvedRun.facts.execution;
}

export async function createWorkerPoolRuntime(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    collectionRunnerErrors: readonly RunnerError[],
    runState: SupervisedRunState
): Promise<WorkerPoolRunRuntime> {
    const units = fileUnits(workerPoolCollectedPlan(resolvedRun));
    const workerCount = defaultWorkerCount(units.length);
    const execution = workerPoolExecutionFacts(resolvedRun);
    const taskResults: RunResult[] = [];

    return {
        activeTasks: new Set(),
        collectedPlan: workerPoolCollectedPlan(resolvedRun),
        collectionRunnerErrors,
        dependencies,
        pool: dependencies.createWorkerPool({
            workerCount,
            workerLifecycle: execution.workerLifecycle
        }),
        poolResourceUsageTracker: createPoolResourceUsageTracker(resolvedRun, dependencies),
        previousPoolSample: createStoredRunValue<ResourceUsageSnapshot | null>(null),
        reporterDelivery: await createReporterDelivery(resolvedRun, dependencies),
        reporterEvents: createReporterEventQueue(),
        resolvedRun,
        runState,
        taskResults,
        terminalFailure: createStoredRunValue(false)
    };
}

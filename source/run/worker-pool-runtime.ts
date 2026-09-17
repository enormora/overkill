import type {
    ResourceUsageSnapshot,
    RunResourceUsage,
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
import type {
    CreatedWorkerPool,
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
    type TinypoolInstance
} from './tinypool-node-compatibility.ts';
import { createResourceUsageFromSamples } from './resource-usage.ts';
import { runTask as workerPoolWorkerEntryPoint } from './worker-pool-worker.ts';
import type { WorkerPoolTask } from './worker-pool-protocol.ts';

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
    readonly destroyPool: boolean;
    readonly finalizeResult: (result: RunResult) => Promise<RunResult>;
    readonly pool: CreatedWorkerPool;
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

type WorkerPoolRoute = {
    readonly pool: CreatedWorkerPool;
    readonly workerLifecycle: RunWorkerLifecycle;
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

function laneLifecycleCount(
    laneLifecycles: ReadonlyMap<string, RunWorkerLifecycle>,
    workerLifecycle: RunWorkerLifecycle
): number {
    return Array
        .from(laneLifecycles.values())
        .filter(function hasWorkerLifecycle(laneWorkerLifecycle) {
            return laneWorkerLifecycle === workerLifecycle;
        })
        .length;
}

function laneCountsByLifecycle(plan: PlacementPlan): ReadonlyMap<RunWorkerLifecycle, number> {
    const laneLifecycles = placementLaneLifecycles(plan);
    const lifecycles: readonly RunWorkerLifecycle[] = [ 'reuse', 'fresh-worker-per-unit' ];

    return new Map(
        lifecycles.map(function toLifecycleCount(workerLifecycle) {
            return [ workerLifecycle, laneLifecycleCount(laneLifecycles, workerLifecycle) ];
        })
    );
}

function workerLifecycles(plan: PlacementPlan): readonly RunWorkerLifecycle[] {
    return Array.from(
        new Set(
            assignedUnits(plan).map(function toWorkerLifecycle(unit) {
                return unit.workerLifecycle;
            })
        )
    );
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
        workerCount,
        workerLifecycle
    };
}

function poolMatchesLifecycle(pool: CreatedWorkerPool, workerLifecycle: RunWorkerLifecycle): boolean {
    return pool.options.isolateWorkers === (workerLifecycle === 'fresh-worker-per-unit');
}

function routeForLifecycle(
    routes: readonly WorkerPoolRoute[],
    workerLifecycle: RunWorkerLifecycle
): WorkerPoolRoute {
    const route = routes.find(function hasWorkerLifecycle(candidate) {
        return candidate.workerLifecycle === workerLifecycle;
    });

    if (route === undefined) {
        throw new Error(`Worker-pool task has no "${workerLifecycle}" route.`);
    }

    return route;
}

function isWorkerPoolTask(value: unknown): value is WorkerPoolTask {
    return typeof value === 'object' &&
        value !== null &&
        Object.hasOwn(value, 'command') &&
        (Reflect.get(value, 'kind') === 'collect' || Reflect.get(value, 'kind') === 'run');
}

function taskWorkerLifecycle(task: unknown): RunWorkerLifecycle {
    if (!isWorkerPoolTask(task)) {
        throw new Error('Worker-pool received an invalid task.');
    }

    return task.command.workerLifecycle;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
    return Array.from(new Set(values)).toSorted(function compareText(left, right) {
        return left.localeCompare(right);
    });
}

function combinedSnapshot(samples: readonly ResourceUsageSnapshot[]): ResourceUsageSnapshot {
    const firstSample = samples[0];

    if (firstSample === undefined) {
        throw new Error('Routed worker-pool resource tracking requires at least one sample.');
    }

    return {
        activeResourceCount: samples.reduce(function sumActiveResources(total, sample) {
            return total + sample.activeResourceCount;
        }, 0),
        activeResourceTypes: uniqueSorted(samples.flatMap(function toActiveTypes(sample) {
            return sample.activeResourceTypes;
        })),
        capturedAtMilliseconds: Math.max(...samples.map(function toCapturedAt(sample) {
            return sample.capturedAtMilliseconds;
        })),
        javaScriptEngineHeapBytes: samples.reduce(function sumHeap(total, sample) {
            return total + sample.javaScriptEngineHeapBytes;
        }, 0),
        residentSetBytes: samples.reduce(function sumResidentSet(total, sample) {
            return total + sample.residentSetBytes;
        }, 0)
    };
}

function createRoutedResourceUsage(
    usages: readonly RunResourceUsage[],
    samples: readonly ResourceUsageSnapshot[]
): RunResourceUsage {
    const start = combinedSnapshot(usages.map(function toStart(usage) {
        return usage.start;
    }));
    const end = combinedSnapshot(usages.map(function toEnd(usage) {
        return usage.end;
    }));

    return createResourceUsageFromSamples(start, end, [ start, ...samples, end ]);
}

function createRoutedResourceUsageTracker(
    trackers: readonly WorkerPoolResourceUsageTracker[]
): WorkerPoolResourceUsageTracker {
    const latestSamples = new Map<number, ResourceUsageSnapshot>();
    let combinedSamples: readonly ResourceUsageSnapshot[] = [];

    return {
        finish() {
            return createRoutedResourceUsage(
                trackers.map(function finishTracker(tracker) {
                    return tracker.finish();
                }),
                combinedSamples
            );
        },
        start(onSample) {
            trackers.forEach(function startTracker(tracker, index) {
                tracker.start(function recordSample(sample) {
                    latestSamples.set(index, sample);

                    if (latestSamples.size === trackers.length) {
                        const combined = combinedSnapshot(Array.from(latestSamples.values()));

                        combinedSamples = [ ...combinedSamples, combined ];
                        onSample?.(combined);
                    }
                });
            });
        },
        async waitForStart() {
            await Promise.all(trackers.map(async function waitForTracker(tracker) {
                await tracker.waitForStart?.();
            }));
        }
    };
}

function createRoutedPool(routes: readonly WorkerPoolRoute[]): CreatedWorkerPool {
    const basePool: CreatedWorkerPool = {
        async destroy() {
            await Promise.all(routes.map(async function destroyRoute(route) {
                await route.pool.destroy();
            }));
        },
        options: {
            isolateWorkers: routes.some(function hasFreshWorkers(route) {
                return route.workerLifecycle === 'fresh-worker-per-unit';
            }),
            maxThreads: routes.reduce(function sumThreads(total, route) {
                return total + route.pool.options.maxThreads;
            }, 0)
        },
        async run(task, options) {
            return await routeForLifecycle(routes, taskWorkerLifecycle(task)).pool.run(task, options);
        },
        setHostOutputSink(sink) {
            for (const route of routes) {
                route.pool.setHostOutputSink?.(sink);
            }
        }
    };

    if (
        routes.every(function routeProvidesTracker(route) {
            return route.pool.createResourceUsageTracker !== undefined;
        })
    ) {
        return {
            ...basePool,
            createResourceUsageTracker(options) {
                return createRoutedResourceUsageTracker(routes.map(function toTracker(route) {
                    const tracker = route.pool.createResourceUsageTracker?.(options);

                    if (tracker === undefined) {
                        throw new Error('Routed worker-pool lost resource tracking support.');
                    }

                    return tracker;
                }));
            }
        };
    }

    return basePool;
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

function createSingleLifecycleExecutionPool(
    input: WorkerPoolRuntimeInput,
    execution: WorkerPoolExecutionFacts,
    placementPlan: PlacementPlan,
    workerLifecycle: RunWorkerLifecycle
): WorkerPoolExecutionPool {
    if (input.createdPool !== null && poolMatchesLifecycle(input.createdPool, workerLifecycle)) {
        return {
            destroyPool: false,
            pool: input.createdPool
        };
    }

    return {
        destroyPool: true,
        pool: input.dependencies.createWorkerPool(
            workerPoolOptions(input.resolvedRun, execution, placementPlan.lanes.length, workerLifecycle)
        )
    };
}

function createMixedLifecycleExecutionPool(
    input: WorkerPoolRuntimeInput,
    execution: WorkerPoolExecutionFacts,
    placementPlan: PlacementPlan,
    lifecycles: readonly RunWorkerLifecycle[]
): WorkerPoolExecutionPool {
    const laneCounts = laneCountsByLifecycle(placementPlan);
    const routes = lifecycles.map(function toRoute(workerLifecycle) {
        return {
            pool: input.dependencies.createWorkerPool(workerPoolOptions(
                input.resolvedRun,
                execution,
                laneCounts.get(workerLifecycle) ?? 0,
                workerLifecycle
            )),
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
    const lifecycles = workerLifecycles(placementPlan);
    const firstLifecycle = lifecycles[0];

    if (firstLifecycle === undefined) {
        return createEmptyExecutionPool(input, execution);
    }

    return lifecycles.length === 1
        ? createSingleLifecycleExecutionPool(input, execution, placementPlan, firstLifecycle)
        : createMixedLifecycleExecutionPool(input, execution, placementPlan, lifecycles);
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
        destroyPool,
        finalizeResult,
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

import type {
    ResourceUsageSnapshot,
    RunResourceUsage
} from '../packages/engine/engine.entry-point.ts';
import type {
    CreatedWorkerPool,
    WorkerPoolResourceUsageTracker
} from './run-orchestrator-dependencies.ts';
import { createResourceUsageFromSamples } from './resource-usage.ts';
import type { RunWorkerLifecycle } from './run-types.ts';
import type { WorkerPoolTask } from './worker-pool-protocol.ts';

export type WorkerPoolRoute = {
    readonly lane: string | null;
    readonly pool: CreatedWorkerPool;
    readonly workerLifecycle: RunWorkerLifecycle;
};

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

function routeForLane(
    routes: readonly WorkerPoolRoute[],
    lane: string
): WorkerPoolRoute {
    const route = routes.find(function hasLane(candidate) {
        return candidate.lane === lane;
    });

    if (route === undefined) {
        throw new Error(`Worker-pool task has no "${lane}" route.`);
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

function taskLane(task: unknown): string | null {
    if (!isWorkerPoolTask(task)) {
        throw new Error('Worker-pool received an invalid task.');
    }

    return task.kind === 'run' ? task.lane : null;
}

function routeForTask(routes: readonly WorkerPoolRoute[], task: unknown): WorkerPoolRoute {
    const lane = taskLane(task);

    return lane === null ? routeForLifecycle(routes, taskWorkerLifecycle(task)) : routeForLane(routes, lane);
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
        capturedAtMicroseconds: Math.max(...samples.map(function toCapturedAt(sample) {
            return sample.capturedAtMicroseconds;
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

export function createRoutedPool(routes: readonly WorkerPoolRoute[]): CreatedWorkerPool {
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
            return await routeForTask(routes, task).pool.run(task, options);
        },
        setHostOutputSink(sink) {
            for (const route of routes) {
                route.pool.setHostOutputSink?.(sink);
            }
        },
        takeHostRunnerErrors() {
            return routes.flatMap(function takeRouteErrors(route) {
                return route.pool.takeHostRunnerErrors?.() ?? [];
            });
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

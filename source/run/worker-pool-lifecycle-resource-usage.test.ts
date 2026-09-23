import {
    type ResourceUsageSnapshot,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type {
    CreatedWorkerPool,
    WorkerPoolCreationOptions,
    WorkerPoolResourceUsageTracker
} from './run-orchestrator-dependencies.ts';
import type { RunWorkerLifecycle } from './run-types.ts';
import { createSupervisedRunState } from './supervised-run-state.ts';
import { createWorkerPoolRuntime, type WorkerPoolRunRuntime } from './worker-pool-runtime.ts';
import {
    fakeDependencies,
    mixedLifecycleResolvedRun,
    type CreatedWorkerPools
} from './worker-pool-lifecycle-routing.test.ts';

function measuredMixedLifecycleResolvedRun(): WorkerPoolRunRuntime['resolvedRun'] {
    const resolvedRun = mixedLifecycleResolvedRun();

    return {
        ...resolvedRun,
        facts: {
            ...resolvedRun.facts,
            execution: {
                ...resolvedRun.facts.execution,
                resourceUsagePolicy: {
                    budgets: {
                        activeResourceCount: null,
                        javaScriptEngineHeapBytes: null,
                        residentSetBytes: null,
                        residentSetGrowthBytesPerSecond: null
                    },
                    measure: true,
                    samplingIntervalMilliseconds: 17
                }
            }
        }
    };
}

function resourceSnapshot(workerLifecycle: RunWorkerLifecycle, capturedAtMicroseconds: number): ResourceUsageSnapshot {
    return {
        activeResourceCount: workerLifecycle === 'reuse' ? 1 : 2,
        activeResourceTypes: [ workerLifecycle ],
        capturedAtMicroseconds,
        javaScriptEngineHeapBytes: workerLifecycle === 'reuse' ? 10 : 20,
        residentSetBytes: workerLifecycle === 'reuse' ? 100 : 200
    };
}

function resourceUsageTracker(workerLifecycle: RunWorkerLifecycle): WorkerPoolResourceUsageTracker {
    return {
        finish() {
            const start = resourceSnapshot(workerLifecycle, 1);
            const end = resourceSnapshot(workerLifecycle, 2);

            return {
                activeResourceTypes: [ workerLifecycle ],
                end,
                peakActiveResourceCount: end.activeResourceCount,
                peakJavaScriptEngineHeapBytes: end.javaScriptEngineHeapBytes,
                peakResidentSetBytes: end.residentSetBytes,
                peakResidentSetGrowthBytesPerSecond: 0,
                sampleCount: 2,
                start
            };
        },
        start(onSample) {
            onSample?.(resourceSnapshot(workerLifecycle, 1));
        },
        async waitForStart() {
            return undefined;
        }
    };
}

function trackingPool(options: WorkerPoolCreationOptions): CreatedWorkerPool {
    return {
        async destroy() {
            return undefined;
        },
        options: {
            isolateWorkers: options.workerLifecycle === 'fresh-worker-per-unit',
            maxThreads: options.workerCount
        },
        createResourceUsageTracker() {
            return resourceUsageTracker(options.workerLifecycle);
        },
        async run() {
            return options.workerLifecycle;
        },
        setHostOutputSink() {
            return undefined;
        }
    };
}

function trackingDependencies(createdWorkerPools: CreatedWorkerPools): WorkerPoolRunRuntime['dependencies'] {
    const routedLifecycles: RunWorkerLifecycle[] = [];
    const routedHostOutputSinks: RunWorkerLifecycle[] = [];

    return {
        ...fakeDependencies(createdWorkerPools, routedLifecycles, routedHostOutputSinks),
        createWorkerPool(options) {
            createdWorkerPools.push(options);

            return trackingPool(options);
        }
    };
}

async function routedResourceUsage(): Promise<{
    readonly samples: readonly ResourceUsageSnapshot[];
    readonly sampleCount: number;
    readonly startActiveResourceTypes: readonly string[];
}> {
    const createdWorkerPools: WorkerPoolCreationOptions[] = [];
    const samples: ResourceUsageSnapshot[] = [];
    const runtime = await createWorkerPoolRuntime({
        collectionRunnerErrors: [],
        createdPool: null,
        dependencies: trackingDependencies(createdWorkerPools),
        async finalizeResult(result) {
            return result;
        },
        resolvedRun: measuredMixedLifecycleResolvedRun(),
        runState: createSupervisedRunState()
    });

    if (runtime.poolResourceUsageTracker === null) {
        throw new Error('Mixed lifecycle resource usage test requires resource tracking.');
    }

    runtime.poolResourceUsageTracker.start(function recordSample(sample) {
        samples.push(sample);
    });
    await runtime.poolResourceUsageTracker.waitForStart?.();
    const usage = runtime.poolResourceUsageTracker.finish();
    await runtime.pool.destroy();

    return {
        sampleCount: usage.sampleCount,
        samples,
        startActiveResourceTypes: usage.start.activeResourceTypes
    };
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-lifecycle-resource-usage.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool runtime combines mixed lifecycle resource tracking',
            async body(scope: OverkillScope) {
                const usage = await routedResourceUsage();

                scope.assert.equal(usage.sampleCount, 3);
                scope.assert.deepEqual(usage.startActiveResourceTypes, [
                    'fresh-worker-per-unit',
                    'reuse'
                ]);
                scope.assert.deepEqual(
                    usage.samples.map(function toActiveResourceCount(sample) {
                        return sample.activeResourceCount;
                    }),
                    [ 3 ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

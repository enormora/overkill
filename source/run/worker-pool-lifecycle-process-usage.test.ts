import { runIfMain } from '#test-runner';
import {
    type ProcessUsageSnapshot,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { WorkerLifecycle } from '../config/types.ts';
import type {
    CreatedWorkerPool,
    WorkerPoolCreationOptions,
    WorkerPoolProcessUsageTracker
} from './run-orchestrator-dependencies.ts';
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
                processUsagePolicy: {
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

function resourceSnapshot(workerLifecycle: WorkerLifecycle, capturedAtMicroseconds: number): ProcessUsageSnapshot {
    return {
        activeResourceCount: workerLifecycle === 'reuse' ? 1 : 2,
        activeResourceTypes: [ workerLifecycle ],
        capturedAtMicroseconds,
        javaScriptEngineHeapBytes: workerLifecycle === 'reuse' ? 10 : 20,
        residentSetBytes: workerLifecycle === 'reuse' ? 100 : 200
    };
}

function processUsageTracker(workerLifecycle: WorkerLifecycle): WorkerPoolProcessUsageTracker {
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
        createProcessUsageTracker() {
            return processUsageTracker(options.workerLifecycle);
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
    const routedLifecycles: WorkerLifecycle[] = [];
    const routedHostOutputSinks: WorkerLifecycle[] = [];

    return {
        ...fakeDependencies(createdWorkerPools, routedLifecycles, routedHostOutputSinks),
        createWorkerPool(options) {
            createdWorkerPools.push(options);

            return trackingPool(options);
        }
    };
}

async function routedProcessUsage(): Promise<{
    readonly samples: readonly ProcessUsageSnapshot[];
    readonly sampleCount: number;
    readonly startActiveResourceTypes: readonly string[];
}> {
    const createdWorkerPools: WorkerPoolCreationOptions[] = [];
    const samples: ProcessUsageSnapshot[] = [];
    const runtime = await createWorkerPoolRuntime({
        attachments: null,
        collectionRunnerErrors: [],
        createdPool: null,
        dependencies: trackingDependencies(createdWorkerPools),
        async finalizeResult(completion) {
            return completion.result;
        },
        resolvedRun: measuredMixedLifecycleResolvedRun(),
        runState: createSupervisedRunState('first-failure-and-final')
    });

    if (runtime.poolProcessUsageTracker === null) {
        throw new Error('Mixed lifecycle process usage test requires process usage tracking.');
    }

    runtime.poolProcessUsageTracker.start(function recordSample(sample) {
        samples.push(sample);
    });
    await runtime.poolProcessUsageTracker.waitForStart?.();
    const usage = runtime.poolProcessUsageTracker.finish();
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
    title: 'source/run/worker-pool-lifecycle-process-usage.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool runtime combines mixed lifecycle process usage tracking',
            async body(scope: OverkillScope) {
                const usage = await routedProcessUsage();

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

await runIfMain(import.meta, testNode);

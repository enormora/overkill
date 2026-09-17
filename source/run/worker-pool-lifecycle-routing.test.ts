import { createDeterministicWallClock } from '@enormora/wall-clock';
import {
    type ResourceUsageSnapshot,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import type {
    CreatedWorkerPool,
    WorkerPoolResourceUsageTracker,
    WorkerPoolCreationOptions
} from './run-orchestrator-dependencies.ts';
import type { RunWorkerLifecycle } from './run-types.ts';
import { createSupervisedRunState } from './supervised-run-state.ts';
import {
    createWorkerPoolRuntime,
    type WorkerPoolRunRuntime
} from './worker-pool-runtime.ts';
import { createWorkerPoolPlacementPlan } from './work-unit-planning.ts';

type CollectedRunPlan = WorkerPoolRunRuntime['collectedPlan'];
type ResolvedRun = WorkerPoolRunRuntime['resolvedRun'];
type PlacementPlan = NonNullable<ResolvedRun['facts']['execution']['placementPlan']>;
type CreatedWorkerPools = {
    readonly push: (...options: readonly WorkerPoolCreationOptions[]) => number;
};
type RoutedLifecycles = {
    readonly push: (...workerLifecycle: readonly RunWorkerLifecycle[]) => number;
};

const integrationPath = 'source/integration-tests/run/fixtures/passing.test.ts';
const secondIntegrationPath = 'source/integration-tests/run/fixtures/delayed-pass.test.ts';
const annotations = { ownership: [], tags: [] };
const controls = { capture: null, timeoutMilliseconds: null };

function collectedCase(title: string): CollectedRunPlan['files'][number]['cases'][number] {
    return {
        annotations,
        controls,
        definitionLocations: [ { kind: 'unknown' as const } ],
        params: null,
        resourceAttachments: {
            directResources: [],
            resourceGraph: [],
            runtimeGraphs: []
        },
        suitePath: title === 'first'
            ? [ { definitionLocations: [ { kind: 'unknown' as const } ], title: 'integration' } ]
            : [],
        testFamily: 'integration',
        title
    };
}

function collectedPlan(): CollectedRunPlan {
    return {
        defined: 2,
        discoveredFiles: [],
        files: [
            { cases: [ collectedCase('first') ], file: integrationPath },
            { cases: [ collectedCase('second') ], file: secondIntegrationPath }
        ],
        orphans: [],
        root: { annotations, controls, title: 'worker pool' }
    };
}

function baseResolvedRun(): ResolvedRun {
    const plan = collectedPlan();

    return {
        collectionRunnerErrors: [],
        config: defaultRunConfig(),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        facts: {
            cases: [],
            environment: {
                node: { arch: 'x64', platform: 'linux', version: '26.1.1' },
                projectRoot: process.cwd(),
                runtimeStateDir: '.overkill'
            },
            execution: {
                assignmentPolicy: 'case-count-balanced',
                baselineUpdateMode: 'none',
                capture: 'buffered',
                debug: { mode: 'off', selectors: [] },
                engine: { kind: 'default' },
                hostProcess: { kind: 'direct' },
                order: 'seeded',
                placementPlan: createWorkerPoolPlacementPlan({
                    assignmentPolicy: 'case-count-balanced',
                    availableParallelism: 2,
                    fileSetForFile() {
                        return null;
                    },
                    order: 'plan',
                    seed: { value: 42n },
                    selectedPlan: plan,
                    scheduling: 'serial',
                    workDistribution: { mode: 'file' },
                    workerLifecycle: 'reuse'
                }),
                processModel: 'worker-pool',
                profile: 'integration',
                resourceUsagePolicy: {
                    budgets: {
                        activeResourceCount: null,
                        javaScriptEngineHeapBytes: null,
                        residentSetBytes: null,
                        residentSetGrowthBytesPerSecond: null
                    },
                    measure: false,
                    samplingIntervalMilliseconds: 100
                },
                scheduling: 'serial',
                testFamily: 'integration',
                timeoutPolicy: {
                    collectionMilliseconds: 1000,
                    hardMilliseconds: 1000,
                    softMilliseconds: 500
                },
                workDistribution: { mode: 'file' },
                workerLifecycle: 'reuse',
                verbose: false
            },
            loader: { sourceMaps: false, stripMode: 'strip-only' },
            reproducibility: {
                selection: { kind: 'all' },
                seed: '42',
                shard: { index: 0, total: 1 }
            }
        },
        plan: { collectedPlan: plan, kind: 'worker-pool' },
        reporters: [],
        request: defaultRunRequest({ paths: [ integrationPath ], profile: 'integration' })
    };
}

function workerLane(id: string): PlacementPlan['lanes'][number] {
    return {
        executor: {
            capabilities: [],
            capacity: 1,
            id,
            kind: 'local-worker'
        },
        id
    };
}

function mixedLifecycleResolvedRun(): ResolvedRun {
    const resolvedRun = baseResolvedRun();
    const { placementPlan } = resolvedRun.facts.execution;

    if (placementPlan === null) {
        throw new Error('Mixed lifecycle test requires a placement plan.');
    }

    const [ firstUnit, secondUnit ] = placementPlan.units;

    if (firstUnit === undefined || secondUnit === undefined) {
        throw new Error('Mixed lifecycle fixture requires two work units.');
    }

    return {
        ...resolvedRun,
        facts: {
            ...resolvedRun.facts,
            execution: {
                ...resolvedRun.facts.execution,
                placementPlan: {
                    assignments: [
                        { lane: 'worker-1', unit: firstUnit.id },
                        { lane: 'worker-2', unit: secondUnit.id }
                    ],
                    lanes: [
                        placementPlan.lanes[0] ?? workerLane('worker-1'),
                        workerLane('worker-2')
                    ],
                    units: [
                        { ...firstUnit, workerLifecycle: 'reuse' },
                        { ...secondUnit, workerLifecycle: 'fresh-worker-per-unit' }
                    ]
                }
            }
        }
    };
}

function measuredMixedLifecycleResolvedRun(): ResolvedRun {
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

function testOnlyDependency(): never {
    throw new Error('Test fixture dependency is not configured.');
}

function fakePool(
    options: WorkerPoolCreationOptions,
    routedLifecycles: RoutedLifecycles
): CreatedWorkerPool {
    return {
        async destroy() {
            return undefined;
        },
        options: {
            isolateWorkers: options.workerLifecycle === 'fresh-worker-per-unit',
            maxThreads: options.workerCount
        },
        async run() {
            routedLifecycles.push(options.workerLifecycle);

            return options.workerLifecycle;
        }
    };
}

function resourceSnapshot(workerLifecycle: RunWorkerLifecycle, capturedAtMilliseconds: number): ResourceUsageSnapshot {
    return {
        activeResourceCount: workerLifecycle === 'reuse' ? 1 : 2,
        activeResourceTypes: [ workerLifecycle ],
        capturedAtMilliseconds,
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
    const routedLifecycles: RunWorkerLifecycle[] = [];
    const pool = fakePool(options, routedLifecycles);

    return {
        ...pool,
        createResourceUsageTracker() {
            return resourceUsageTracker(options.workerLifecycle);
        }
    };
}

function fakeDependencies(
    createdWorkerPools: CreatedWorkerPools,
    routedLifecycles: RoutedLifecycles
): WorkerPoolRunRuntime['dependencies'] {
    return {
        availableParallelism: 2,
        createResourceUsageTracker: testOnlyDependency,
        createSeed() {
            return 42n;
        },
        createWorkerPool(options) {
            createdWorkerPools.push(options);

            return fakePool(options, routedLifecycles);
        },
        defaultEngine: defaultRunEngine,
        discoverRunFilesWithProjectRoot: testOnlyDependency,
        execute: defaultRunEngine.execute,
        liveOutput: {
            stderr: {
                write() {
                    return undefined;
                }
            },
            stdout: {
                write() {
                    return undefined;
                }
            }
        },
        loadRunEngineModule: testOnlyDependency,
        loadRunTestModules: testOnlyDependency,
        node: { arch: 'x64', platform: 'linux', version: '26.1.1' },
        reporterDispatcher: {
            async createDelivery() {
                return {
                    async disposeReporters() {
                        return [];
                    },
                    async reportEvent() {
                        return [];
                    },
                    async reportResult() {
                        return [];
                    }
                };
            },
            async trackRunnerErrorDelivery(work) {
                return { deliveredRunnerErrors: [], result: await work() };
            }
        },
        runtimeCapabilityPolicy: {
            installIpcRestriction() {
                return function restoreIpcRestriction() {
                    return undefined;
                };
            },
            installProcessExecutionRestriction() {
                return function restoreProcessExecutionRestriction() {
                    return undefined;
                };
            },
            readEnvironment() {
                return {};
            },
            readStorage() {
                return null;
            }
        },
        startSupervisedChild: testOnlyDependency,
        startWorkerPoolHost: testOnlyDependency,
        wallClock: createDeterministicWallClock()
    };
}

function trackingDependencies(createdWorkerPools: CreatedWorkerPools): WorkerPoolRunRuntime['dependencies'] {
    const routedLifecycles: RunWorkerLifecycle[] = [];

    return {
        ...fakeDependencies(createdWorkerPools, routedLifecycles),
        createWorkerPool(options) {
            createdWorkerPools.push(options);

            return trackingPool(options);
        }
    };
}

function lifecycleTask(workerLifecycle: RunWorkerLifecycle): unknown {
    return {
        command: { workerLifecycle },
        kind: 'run'
    };
}

function invalidWorkerPoolTask(): unknown {
    return {
        command: { workerLifecycle: 'reuse' },
        kind: 'invalid'
    };
}

function runOptions(): Parameters<CreatedWorkerPool['run']>[1] {
    const controller = new AbortController();

    return {
        name: 'runTask',
        signal: controller.signal,
        transferList: []
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

async function assertRoutedPoolErrors(scope: OverkillScope, runtime: WorkerPoolRunRuntime): Promise<void> {
    await scope.assert.rejects(async function runInvalidTask() {
        await runtime.pool.run(invalidWorkerPoolTask(), runOptions());
    }, { message: 'Worker-pool received an invalid task.' });
    await scope.assert.rejects(async function runUnknownLifecycle() {
        await runtime.pool.run({
            command: { workerLifecycle: 'unknown' },
            kind: 'run'
        }, runOptions());
    }, { message: 'Worker-pool task has no "unknown" route.' });
}

async function assertRoutedLifecycleRuns(
    scope: OverkillScope,
    runtime: WorkerPoolRunRuntime,
    routedLifecycles: readonly RunWorkerLifecycle[]
): Promise<void> {
    scope.assert.equal(runtime.pool.options.maxThreads, 2);
    scope.assert.equal(await runtime.pool.run(lifecycleTask('reuse'), runOptions()), 'reuse');
    scope.assert.equal(
        await runtime.pool.run(lifecycleTask('fresh-worker-per-unit'), runOptions()),
        'fresh-worker-per-unit'
    );
    scope.assert.deepEqual(routedLifecycles, [ 'reuse', 'fresh-worker-per-unit' ]);
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-lifecycle-routing.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool runtime splits and routes mixed lifecycle pools',
            async body(scope: OverkillScope) {
                const createdWorkerPools: WorkerPoolCreationOptions[] = [];
                const routedLifecycles: RunWorkerLifecycle[] = [];
                const runtime = await createWorkerPoolRuntime({
                    collectionRunnerErrors: [],
                    createdPool: null,
                    dependencies: fakeDependencies(createdWorkerPools, routedLifecycles),
                    resolvedRun: mixedLifecycleResolvedRun(),
                    runState: createSupervisedRunState()
                });

                await assertRoutedLifecycleRuns(scope, runtime, routedLifecycles);
                scope.assert.deepEqual(createdWorkerPools, [
                    { cwd: process.cwd(), hostProcess: { kind: 'direct' }, workerCount: 1, workerLifecycle: 'reuse' },
                    {
                        cwd: process.cwd(),
                        hostProcess: { kind: 'direct' },
                        workerCount: 1,
                        workerLifecycle: 'fresh-worker-per-unit'
                    }
                ]);
                await assertRoutedPoolErrors(scope, runtime);

                await runtime.pool.destroy();

                return scope.assert.collect();
            }
        }),
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

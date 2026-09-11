import { createDeterministicWallClock } from '@enormora/wall-clock';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import type {
    CreatedWorkerPool,
    RunOrchestratorDependencies,
    WorkerPoolCreationOptions
} from './run-orchestrator-dependencies.ts';
import type { RunWorkerLifecycle } from './run-types.ts';
import { createSupervisedRunState } from './supervised-run-state.ts';
import {
    createWorkerPoolRuntime,
    type WorkerPoolRunRuntime
} from './worker-pool-runtime.ts';

type CollectedRunPlan = WorkerPoolRunRuntime['collectedPlan'];
type ResolvedRun = WorkerPoolRunRuntime['resolvedRun'];

const integrationPath = 'source/integration-tests/run/fixtures/passing.test.ts';
const annotations = { ownership: [], tags: [] };
const controls = { capture: null, timeoutMilliseconds: null };

function createCollectedPlan(): CollectedRunPlan {
    return {
        defined: 1,
        discoveredFiles: [],
        files: [
            {
                file: integrationPath,
                cases: [
                    {
                        annotations,
                        controls,
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        params: null,
                        suitePath: [
                            { definitionLocations: [ { kind: 'unknown' as const } ], title: 'integration' }
                        ],
                        testFamily: 'integration',
                        title: 'first'
                    }
                ]
            }
        ],
        orphans: [],
        root: { annotations, controls, title: 'worker pool' }
    };
}

function workerPoolResolvedRun(collectedPlan: CollectedRunPlan): ResolvedRun {
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
                baselineUpdateMode: 'none',
                capture: 'buffered',
                debug: { mode: 'off', selectors: [] },
                engine: { kind: 'default' },
                order: 'seeded',
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
        plan: { collectedPlan, kind: 'worker-pool' },
        reporters: [],
        request: defaultRunRequest({ paths: [ integrationPath ], profile: 'integration' })
    };
}

function testOnlyDependency(): never {
    throw new Error('Test fixture dependency is not configured.');
}

function createFakePool(maxThreads: number, isolateWorkers: boolean): CreatedWorkerPool {
    return {
        async destroy() {
            return undefined;
        },
        options: { isolateWorkers, maxThreads },
        async run() {
            throw new Error('Fake worker pool did not receive a task implementation.');
        }
    };
}

const createFakeWorkerPool: RunOrchestratorDependencies['createWorkerPool'] = function createFakeWorkerPool(options) {
    return createFakePool(options.workerCount, options.workerLifecycle === 'fresh-worker-per-unit');
};

function fakeDependencies(): WorkerPoolRunRuntime['dependencies'] {
    return {
        createResourceUsageTracker: testOnlyDependency,
        createSeed() {
            return 42n;
        },
        createWorkerPool: createFakeWorkerPool,
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
        wallClock: createDeterministicWallClock()
    };
}

function resourceMeasurementResolvedRun(): ResolvedRun {
    const resolvedRun = workerPoolResolvedRun(createCollectedPlan());

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
                        residentSetBytes: 10,
                        residentSetGrowthBytesPerSecond: null
                    },
                    measure: true,
                    samplingIntervalMilliseconds: 17
                }
            }
        }
    };
}

function workerPoolResolvedRunWithLifecycle(workerLifecycle: RunWorkerLifecycle): ResolvedRun {
    const resolvedRun = workerPoolResolvedRun(createCollectedPlan());

    if (resolvedRun.facts.execution.processModel !== 'worker-pool') {
        throw new Error('Worker-pool lifecycle test requires worker-pool execution facts.');
    }

    return {
        ...resolvedRun,
        facts: {
            ...resolvedRun.facts,
            execution: {
                ...resolvedRun.facts.execution,
                workerLifecycle
            }
        }
    };
}

function supervisedExecutionFacts(): ResolvedRun['facts']['execution'] {
    return {
        baselineUpdateMode: 'none',
        capture: 'buffered',
        debug: { mode: 'off', selectors: [] },
        engine: { kind: 'default' },
        order: 'seeded',
        processModel: 'supervised-process',
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
        verbose: false
    };
}

function workerPoolPlanWithSupervisedFacts(): ResolvedRun {
    const resolvedRun = workerPoolResolvedRun(createCollectedPlan());

    return {
        ...resolvedRun,
        facts: {
            ...resolvedRun.facts,
            execution: supervisedExecutionFacts()
        }
    };
}

async function workerPoolRuntimeCreation(): Promise<{
    readonly createdWorkerPools: readonly WorkerPoolCreationOptions[];
    readonly measuredSamplingInterval: number;
    readonly measuredThreads: number;
    readonly measuredTracker: WorkerPoolRunRuntime['poolResourceUsageTracker'];
    readonly unmeasuredThreads: number;
    readonly unmeasuredTracker: WorkerPoolRunRuntime['poolResourceUsageTracker'];
}> {
    const createdWorkerPools: WorkerPoolCreationOptions[] = [];
    let measuredSamplingInterval = 0;
    const dependencies: WorkerPoolRunRuntime['dependencies'] = {
        ...fakeDependencies(),
        createResourceUsageTracker(options) {
            measuredSamplingInterval = options.samplingIntervalMilliseconds;

            return {
                finish: testOnlyDependency,
                start() {
                    return undefined;
                }
            };
        },
        createWorkerPool(options) {
            createdWorkerPools.push(options);

            return createFakeWorkerPool(options);
        }
    };
    const unmeasuredRuntime = await createWorkerPoolRuntime(
        workerPoolResolvedRun({ ...createCollectedPlan(), files: [] }),
        dependencies,
        [],
        createSupervisedRunState()
    );
    const measuredRuntime = await createWorkerPoolRuntime(
        resourceMeasurementResolvedRun(),
        dependencies,
        [],
        createSupervisedRunState()
    );
    const freshRuntime = await createWorkerPoolRuntime(
        workerPoolResolvedRunWithLifecycle('fresh-worker-per-unit'),
        dependencies,
        [],
        createSupervisedRunState()
    );

    await unmeasuredRuntime.pool.destroy();
    await measuredRuntime.pool.destroy();
    await freshRuntime.pool.destroy();

    return {
        createdWorkerPools,
        measuredSamplingInterval,
        measuredThreads: measuredRuntime.pool.options.maxThreads,
        measuredTracker: measuredRuntime.poolResourceUsageTracker,
        unmeasuredThreads: unmeasuredRuntime.pool.options.maxThreads,
        unmeasuredTracker: unmeasuredRuntime.poolResourceUsageTracker
    };
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-runtime.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool runtime creation sizes pools and installs resource tracking',
            async body(scope: OverkillScope) {
                const result = await workerPoolRuntimeCreation();

                scope.assert.equal(result.unmeasuredThreads, 0);
                scope.assert.equal(result.unmeasuredTracker, null);
                scope.assert.equal(result.measuredThreads, 1);
                scope.assert.equal(result.measuredSamplingInterval, 17);
                scope.assert.notEqual(result.measuredTracker, null);
                scope.assert.deepEqual(result.createdWorkerPools, [
                    { workerCount: 0, workerLifecycle: 'reuse' },
                    { workerCount: 1, workerLifecycle: 'reuse' },
                    { workerCount: 1, workerLifecycle: 'fresh-worker-per-unit' }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool runtime creation rejects non-worker-pool facts',
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function createMismatchedRuntime() {
                    await createWorkerPoolRuntime(
                        workerPoolPlanWithSupervisedFacts(),
                        fakeDependencies(),
                        [],
                        createSupervisedRunState()
                    );
                }, {
                    message: 'Worker-pool execution requires worker-pool execution facts.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

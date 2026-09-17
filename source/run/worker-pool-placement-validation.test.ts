import { createDeterministicWallClock } from '@enormora/wall-clock';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type CaseId,
    type RunResult,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';
import { createRunResultFromCollectedPlan } from './collected-run-plan.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import type {
    CreatedWorkerPool
} from './run-orchestrator-dependencies.ts';
import { createStoredRunValue, createSupervisedRunState } from './supervised-run-state.ts';
import { executeWorkerPoolUnits, reportRunStart } from './worker-pool-execution.ts';
import type {
    WorkerPoolRunRuntime
} from './worker-pool-runtime.ts';

type CollectedRunPlan = WorkerPoolRunRuntime['collectedPlan'];
type ResolvedRun = WorkerPoolRunRuntime['resolvedRun'];
type PlacementPlan = NonNullable<ResolvedRun['facts']['execution']['placementPlan']>;
type ResourceSample = ReturnType<WorkerPoolRunRuntime['previousPoolSample']['read']>;
type WorkUnit = PlacementPlan['units'][number];

export const integrationPath = 'source/integration-tests/run/fixtures/passing.test.ts';
const annotations = { ownership: [], tags: [] };
const controls = { capture: null, timeoutMilliseconds: null };
export const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
} as const;
const defaultUnitPolicy = {
    order: 'plan',
    resourceConstraints: {
        affinityKeys: [],
        capacityWeight: 1,
        faultDomains: [],
        serialKeys: [],
        singleWorkerKeys: []
    },
    scheduling: 'serial',
    workerLifecycle: 'reuse'
} as const;

function firstCaseId(): CaseId {
    return {
        file: integrationPath,
        params: null,
        suite: [ 'integration' ],
        title: 'first'
    };
}

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
                        resourceAttachments: {
                            directResources: [],
                            resourceGraph: [],
                            runtimeGraphs: []
                        },
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

function firstWorkUnit(): WorkUnit {
    return {
        group: null,
        id: {
            key: integrationPath,
            mode: 'file',
            runtimes: [],
            workload: null
        },
        ...defaultUnitPolicy,
        work: [
            {
                case: firstCaseId(),
                runtimes: [],
                workload: null
            }
        ]
    };
}

export function placementPlan(): PlacementPlan {
    const unit = firstWorkUnit();

    return {
        assignments: [ { lane: 'worker-1', unit: unit.id } ],
        lanes: [
            {
                executor: {
                    capabilities: [],
                    capacity: 1,
                    id: 'worker-1',
                    kind: 'local-worker'
                },
                id: 'worker-1'
            }
        ],
        units: [ unit ]
    };
}

function placementPlanWithMissingUnit(): PlacementPlan {
    return {
        ...placementPlan(),
        assignments: [
            {
                lane: 'worker-1',
                unit: {
                    key: 'missing',
                    mode: 'file',
                    runtimes: [],
                    workload: null
                }
            }
        ]
    };
}

export function placementPlanWithGroupUnit(): PlacementPlan {
    const unit: WorkUnit = {
        ...firstWorkUnit(),
        id: {
            key: 'grouped',
            mode: 'group',
            runtimes: [],
            workload: null
        }
    };

    return {
        ...placementPlan(),
        assignments: [ { lane: 'worker-1', unit: unit.id } ],
        units: [ unit ]
    };
}

export function placementPlanWithUnitPolicy(): PlacementPlan {
    const unit: WorkUnit = {
        ...firstWorkUnit(),
        scheduling: 'concurrent',
        workerLifecycle: 'fresh-worker-per-unit'
    };

    return {
        ...placementPlan(),
        assignments: [ { lane: 'worker-1', unit: unit.id } ],
        units: [ unit ]
    };
}

function placementPlanAssignedToSecondLane(): PlacementPlan {
    const base = placementPlan();
    const unit = firstWorkUnit();

    return {
        ...base,
        assignments: [ { lane: 'worker-2', unit: unit.id } ],
        lanes: [
            ...base.lanes,
            {
                executor: {
                    capabilities: [],
                    capacity: 1,
                    id: 'worker-2',
                    kind: 'local-worker'
                },
                id: 'worker-2'
            }
        ],
        units: [ unit ]
    };
}

function workerPoolResolvedRun(placement: PlacementPlan): ResolvedRun {
    return {
        collectionRunnerErrors: [],
        config: defaultRunConfig(),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        facts: {
            durationHistory: null,
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
                placementPlan: placement,
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
        plan: { collectedPlan: createCollectedPlan(), kind: 'worker-pool' },
        reporters: [],
        request: defaultRunRequest({ paths: [ integrationPath ], profile: 'integration' })
    };
}

function testOnlyDependency(): never {
    throw new Error('Test fixture dependency is not configured.');
}

function createFakePool(): CreatedWorkerPool {
    return {
        async destroy() {
            return undefined;
        },
        options: { isolateWorkers: false, maxThreads: 1 },
        async run() {
            throw new Error('Fake worker pool did not receive a task implementation.');
        }
    };
}

type CapturedWorkerTask = {
    readonly assignedWork: readonly unknown[];
    readonly command: {
        readonly paths: readonly string[];
        readonly scheduling: 'concurrent' | 'serial';
        readonly workerLifecycle: 'fresh-worker-per-unit' | 'reuse';
    };
};

export type AcceptingPool = {
    readonly capturedTasks: readonly CapturedWorkerTask[];
    readonly pool: CreatedWorkerPool;
};

export function createAcceptingPool(): AcceptingPool {
    const capturedTasks: CapturedWorkerTask[] = [];

    return {
        capturedTasks,
        pool: {
            async destroy() {
                return undefined;
            },
            options: { isolateWorkers: false, maxThreads: 1 },
            async run(task) {
                const workerTask = task as CapturedWorkerTask;

                capturedTasks.push(workerTask);

                return {
                    result: createRunResultFromCollectedPlan(
                        createCollectedPlan(),
                        [],
                        [],
                        {
                            resourceUsage: null,
                            startedAtMs: 0,
                            wallClock: createDeterministicWallClock()
                        }
                    )
                };
            }
        }
    };
}

async function emptyReporterErrors(): Promise<readonly []> {
    return [];
}

const fakeReporterDelivery: WorkerPoolRunRuntime['reporterDelivery'] = {
    disposeReporters: emptyReporterErrors,
    reportEvent: emptyReporterErrors,
    reportResult: emptyReporterErrors
};

function fakeDependencies(): WorkerPoolRunRuntime['dependencies'] {
    return {
        availableParallelism: 2,
        createResourceUsageTracker: testOnlyDependency,
        createSeed() {
            return 42n;
        },
        createWorkerPool: createFakePool,
        defaultEngine: defaultRunEngine,
        durationHistoryStore: {
            async read() {
                return null;
            },
            async write() {
                return undefined;
            }
        },
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
                return fakeReporterDelivery;
            },
            async trackRunnerErrorDelivery(work) {
                return {
                    deliveredRunnerErrors: [],
                    result: await work(),
                    undeliveredRunnerErrors: []
                };
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

export function fakeWorkerRuntime(placement: PlacementPlan): WorkerPoolRunRuntime {
    const taskResults: RunResult[] = [];

    return {
        activeTasks: new Set(),
        collectedPlan: createCollectedPlan(),
        collectionRunnerErrors: [],
        dependencies: fakeDependencies(),
        destroyPool: true,
        async finalizeResult(result) {
            return result;
        },
        pool: createFakePool(),
        poolResourceUsageTracker: null,
        previousPoolSample: createStoredRunValue<ResourceSample>(null),
        reporterDelivery: fakeReporterDelivery,
        reporterEvents: {
            add() {
                return undefined;
            },
            async wait() {
                return undefined;
            }
        },
        resolvedRun: workerPoolResolvedRun(placement),
        runState: createSupervisedRunState(),
        taskResults,
        terminalFailure: createStoredRunValue(false)
    };
}

function runtimeWithInstanceEngine(): WorkerPoolRunRuntime {
    const runtime = fakeWorkerRuntime(placementPlan());

    return {
        ...runtime,
        resolvedRun: {
            ...runtime.resolvedRun,
            engine: { engine: defaultRunEngine, kind: 'instance' }
        }
    };
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-placement-validation.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool execution rejects placement assignments for missing units',
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function executeMissingUnit() {
                    await executeWorkerPoolUnits(fakeWorkerRuntime(placementPlan()), placementPlanWithMissingUnit(), 0);
                }, { message: 'Placement assignment referenced an unknown work unit.' });
                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool execution skips run start for empty placement plans',
            async body(scope: OverkillScope) {
                let reportedEvents = 0;
                const runtime = {
                    ...fakeWorkerRuntime({ assignments: [], lanes: [], units: [] }),
                    reporterDelivery: {
                        ...fakeReporterDelivery,
                        async reportEvent() {
                            reportedEvents += 1;

                            return [];
                        }
                    }
                };
                await reportRunStart(runtime, 0);
                scope.assert.equal(reportedEvents, 0);
                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool execution runs only units assigned to each lane',
            async body(scope: OverkillScope) {
                const acceptingPool = createAcceptingPool();
                const placement = placementPlanAssignedToSecondLane();
                const runtime = {
                    ...fakeWorkerRuntime(placement),
                    pool: acceptingPool.pool
                };
                const completed = await executeWorkerPoolUnits(runtime, placement, 0);
                scope.assert.equal(completed.length, 1);
                scope.assert.equal(acceptingPool.capturedTasks.length, 1);
                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool execution reports instance engines as crashes',
            async body(scope: OverkillScope) {
                const completed = await executeWorkerPoolUnits(runtimeWithInstanceEngine(), placementPlan(), 0);
                scope.assert.equal(completed.length, 3);
                scope.assert.equal(
                    completed[0]?.state.runnerErrors()[0]?.message,
                    'Instance engines are not supported with worker-pool execution. Use a module engine.'
                );
                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

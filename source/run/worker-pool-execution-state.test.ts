import { createDeterministicWallClock } from '@enormora/wall-clock';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type CaseId,
    type PerTestResult,
    type RunResult,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import type {
    CreatedWorkerPool,
    RunOrchestratorDependencies
} from './run-orchestrator-dependencies.ts';
import { createStoredRunValue, createSupervisedRunState, type SupervisedRunState } from './supervised-run-state.ts';
import { executeWorkerPoolUnits, reportRunStart, startPoolResourceTracking } from './worker-pool-execution.ts';
import { createEmptyWorkerPoolResult, finishWorkerPoolRun } from './worker-pool-results.ts';
import type {
    WorkerPoolRunRuntime,
    WorkerPoolTaskRun
} from './worker-pool-runtime.ts';

type CollectedRunPlan = WorkerPoolRunRuntime['collectedPlan'];
type ResolvedRun = WorkerPoolRunRuntime['resolvedRun'];
type ResourceSample = ReturnType<WorkerPoolRunRuntime['previousPoolSample']['read']>;

const integrationPath = 'source/integration-tests/run/fixtures/passing.test.ts';
const annotations = { ownership: [], tags: [] };
const controls = { capture: null, timeoutMilliseconds: null };
const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
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

async function emptyReporterErrors(): Promise<readonly []> {
    return [];
}

const fakeReporterDelivery: WorkerPoolRunRuntime['reporterDelivery'] = {
    disposeReporters: emptyReporterErrors,
    reportEvent: emptyReporterErrors,
    reportResult: emptyReporterErrors
};

async function createFakeReporterDelivery(): Promise<WorkerPoolRunRuntime['reporterDelivery']> {
    return fakeReporterDelivery;
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
            createDelivery: createFakeReporterDelivery,
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

function fakeWorkerRuntime(collectedPlan: CollectedRunPlan): WorkerPoolRunRuntime {
    const taskResults: RunResult[] = [];

    return {
        activeTasks: new Set(),
        collectedPlan,
        collectionRunnerErrors: [],
        dependencies: fakeDependencies(),
        pool: createFakePool(1, false),
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
        resolvedRun: workerPoolResolvedRun(collectedPlan),
        runState: createSupervisedRunState(),
        taskResults,
        terminalFailure: createStoredRunValue(false)
    };
}

function createTaskRun(state: SupervisedRunState): WorkerPoolTaskRun {
    const timeout = createStoredRunValue<ReturnType<RunOrchestratorDependencies['wallClock']['setTimeout']> | null>(
        null
    );

    return {
        controller: new AbortController(),
        endedByParent: createStoredRunValue(false),
        requeuePendingCases: createStoredRunValue(false),
        state,
        startedCases: new Set(),
        timeout,
        unit: { assignedCases: [], file: integrationPath }
    };
}

function emptyRunResult(perTest: readonly PerTestResult[]): RunResult {
    return {
        artifacts: [],
        bySuite: {},
        orphans: [],
        perTest,
        resourceUsage: null,
        runnerErrors: [],
        summary: {
            crashed: 0,
            defined: 0,
            discovered: 0,
            failed: 0,
            inconclusive: 0,
            passed: perTest.length,
            planned: perTest.length,
            resourceExhausted: 0,
            runtimePolicy: 0,
            skipped: 0
        },
        wallTimeMs: 0
    };
}

function passResult(): PerTestResult {
    return { id: firstCaseId(), outcome: { kind: 'pass' }, verdict: 'pass' };
}

function invalidOutputRuntime(recordRun: () => void): WorkerPoolRunRuntime {
    const runtime = fakeWorkerRuntime(createCollectedPlan());
    const pool = createFakePool(1, false);
    pool.run = async function runInvalidWorkerTask() {
        recordRun();

        return { invalid: true };
    };

    return { ...runtime, pool };
}

function budgetedRuntime(taskRun: WorkerPoolTaskRun): WorkerPoolRunRuntime {
    const runtime = fakeWorkerRuntime(createCollectedPlan());

    return {
        ...runtime,
        activeTasks: new Set([ taskRun ]),
        poolResourceUsageTracker: {
            finish: testOnlyDependency,
            start(recordSample) {
                recordSample?.({
                    activeResourceCount: 0,
                    activeResourceTypes: [],
                    capturedAtMilliseconds: 1,
                    javaScriptEngineHeapBytes: 1,
                    residentSetBytes: 20
                });
            }
        },
        resolvedRun: {
            ...runtime.resolvedRun,
            facts: {
                ...runtime.resolvedRun.facts,
                execution: {
                    ...runtime.resolvedRun.facts.execution,
                    resourceUsagePolicy: {
                        budgets: {
                            activeResourceCount: null,
                            javaScriptEngineHeapBytes: null,
                            residentSetBytes: 10,
                            residentSetGrowthBytesPerSecond: null
                        },
                        measure: true,
                        samplingIntervalMilliseconds: 5
                    }
                }
            }
        }
    };
}

async function workerPoolFinalizationResults(): Promise<{
    readonly emptyResult: RunResult;
    readonly result: RunResult;
}> {
    const runtime = fakeWorkerRuntime(createCollectedPlan());
    const completedState = createSupervisedRunState();

    runtime.runState.recordCapturedOutput('stdout', Buffer.from('run artifact'), 1);
    completedState.recordCapturedOutput('stderr', Buffer.from('completed artifact'), 2);
    runtime.taskResults.push(emptyRunResult([ passResult() ]));

    const result = await finishWorkerPoolRun(runtime, [ createTaskRun(completedState) ], 10);
    const emptyResult = await createEmptyWorkerPoolResult(
        workerPoolResolvedRun(createCollectedPlan()),
        runtime.dependencies,
        createSupervisedRunState()
    );

    return { emptyResult, result };
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-execution-state.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool execution stops after repeated invalid worker outputs',
            async body(scope: OverkillScope) {
                let poolRuns = 0;
                const runtime = invalidOutputRuntime(function recordRun() {
                    poolRuns += 1;
                });
                const completed = await executeWorkerPoolUnits(
                    runtime,
                    [ { assignedCases: [ firstCaseId() ], file: integrationPath } ],
                    0
                );

                scope.assert.equal(poolRuns, 3);
                scope.assert.equal(runtime.terminalFailure.read(), true);
                scope.assert.equal(
                    runtime.runState.runnerErrors()[0]?.message,
                    'Worker-pool stopped after 3 worker crashes.'
                );
                scope.assert.equal(completed.length, 3);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool resource tracking stops active tasks on pool budget breach',
            async body(scope: OverkillScope) {
                const activeTask = createTaskRun(createSupervisedRunState());
                const runtime = budgetedRuntime(activeTask);

                activeTask.state.addActiveCase('first', { capture: null, id: firstCaseId() });
                await reportRunStart({ ...runtime, collectedPlan: { ...runtime.collectedPlan, files: [] } }, 0);
                startPoolResourceTracking(runtime);

                scope.assert.equal(runtime.terminalFailure.read(), true);
                scope.assert.equal(activeTask.controller.signal.aborted, true);
                scope.assert.equal(activeTask.state.perTestResults()[0]?.verdict, 'resource-exhausted');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool finalization and empty results aggregate run state',
            async body(scope: OverkillScope) {
                const { emptyResult, result } = await workerPoolFinalizationResults();

                scope.assert.equal(result.perTest[0]?.id.title, 'first');
                scope.assert.deepEqual(
                    result.artifacts.map(function toText(artifact) {
                        return artifact.payload.text;
                    }),
                    [ 'run artifact', 'completed artifact' ]
                );
                scope.assert.equal(emptyResult.summary.planned, 1);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

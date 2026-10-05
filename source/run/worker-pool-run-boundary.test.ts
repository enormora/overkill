import { createDeterministicClock } from '@enormora/clock';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { fakeWorkerPoolRuntimeDependencies } from '../test-support/worker-pool-runtime-fixtures.ts';
import type {
    CreatedWorkerPool,
    RunOrchestratorDependencies,
    WorkerPoolCreationOptions
} from './run-orchestrator-dependencies.ts';
import type { CollectedRunPlan } from './run-types.ts';
import { createRunTimingMeasurement } from './run-timing-collection.ts';
import type {
    WorkerPoolCollection,
    WorkerPoolCommand
} from './worker-pool-protocol.ts';
import {
    executeWorkerPoolRun,
    runWorkerPoolCommand
} from './worker-pool-run.ts';
import {
    createCollectedPlan,
    workerPoolResolvedRun
} from './worker-pool-runtime.test.ts';

type FakePoolInput = {
    readonly destroy: () => Promise<void>;
    readonly run: () => Promise<WorkerPoolCollection>;
};

type RecordedPoolDependencies = {
    readonly createdOptions: () => readonly WorkerPoolCreationOptions[];
    readonly dependencies: RunOrchestratorDependencies;
};

function workerPoolCommand(hostProcess: WorkerPoolCommand['hostProcess']): WorkerPoolCommand {
    return {
        retryPolicy: null,
        collectionTimeoutMilliseconds: 100,
        cwd: process.cwd(),
        definitionLocationCapture: 'disabled',
        engine: { kind: 'default' },
        hardTimeoutMilliseconds: 1000,
        maxConcurrency: 5,
        hostProcess,
        paths: [ 'source/integration-tests/run/fixtures/passing.test.ts' ],
        resourceBudgets: {
            activeResourceCount: null,
            javaScriptEngineHeapBytes: null,
            residentSetBytes: null,
            residentSetGrowthBytesPerSecond: null
        },
        resourceUsageSamplingIntervalMilliseconds: 1,
        root: { annotations: {}, controls: {}, title: process.cwd() },
        scheduling: 'serial',
        testFamily: 'integration',
        timeoutMilliseconds: 1000,
        workerLifecycle: 'fresh-worker-per-unit'
    };
}

function emptyCollectionPlan(): CollectedRunPlan {
    return { ...createCollectedPlan(), files: [] };
}

async function collection(): Promise<WorkerPoolCollection> {
    return {
        collectedPlan: emptyCollectionPlan(),
        runnerErrors: []
    };
}

function createFakePool(input: FakePoolInput): CreatedWorkerPool {
    return {
        async destroy() {
            await input.destroy();
        },
        options: {
            isolateWorkers: true,
            maxThreads: 1
        },
        async run() {
            return await input.run();
        },
        setHostOutputSink() {
            return undefined;
        }
    };
}

function createRecordedPoolDependencies(): RecordedPoolDependencies {
    const createdOptions: WorkerPoolCreationOptions[] = [];
    const baseDependencies = fakeWorkerPoolRuntimeDependencies();

    return {
        createdOptions() {
            return createdOptions;
        },
        dependencies: {
            ...baseDependencies,
            createWorkerPool(options) {
                createdOptions.push(options);

                return createFakePool({
                    async destroy() {
                        return undefined;
                    },
                    run: collection
                });
            }
        }
    };
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-run-boundary.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'executeWorkerPoolRun() creates empty results with default execution state',
            async body(scope: OverkillScope) {
                const result = await executeWorkerPoolRun(
                    workerPoolResolvedRun({ ...createCollectedPlan(), files: [] }),
                    fakeWorkerPoolRuntimeDependencies(),
                    {
                        async finalizeResult(_resolvedRun, completion) {
                            return completion.result;
                        },
                        timing: null
                    }
                );

                scope.assert.equal(result.planStatus, 'empty-selection');
                scope.assert.equal(result.summary.planned, 0);
                scope.assert.deepEqual(result.runnerErrors, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runWorkerPoolCommand() creates collection pools for direct hosts',
            async body(scope: OverkillScope) {
                const fixture = createRecordedPoolDependencies();
                const result = await runWorkerPoolCommand(
                    workerPoolCommand({ kind: 'direct' }),
                    fixture.dependencies,
                    async function createResolvedRun(collectionResult) {
                        return workerPoolResolvedRun(collectionResult.collectedPlan);
                    },
                    {
                        async finalizeResult(_resolvedRun, completion) {
                            return completion.result;
                        },
                        timing: null
                    }
                );
                const [ createdOptions ] = fixture.createdOptions();

                scope.assert.equal(result.planStatus, 'empty-selection');
                scope.assert.equal(createdOptions?.workerCount, 1);
                scope.assert.equal(
                    createdOptions === undefined ? true : Object.hasOwn(createdOptions, 'timing'),
                    false
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runWorkerPoolCommand() owns child-host pools without timing collection',
            async body(scope: OverkillScope) {
                let destroyed = false;
                const baseDependencies = fakeWorkerPoolRuntimeDependencies();
                const result = await runWorkerPoolCommand(
                    workerPoolCommand({ kind: 'child', nodeArguments: [ '--conditions=overkill-test' ] }),
                    {
                        ...baseDependencies,
                        createWorkerPool(options) {
                            scope.assert.equal(Object.hasOwn(options, 'timing'), false);
                            scope.assert.equal(options.workerCount, 1);

                            return createFakePool({
                                async destroy() {
                                    destroyed = true;
                                },
                                run: collection
                            });
                        }
                    },
                    async function createResolvedRun(collectionResult) {
                        return workerPoolResolvedRun(collectionResult.collectedPlan);
                    },
                    {
                        async finalizeResult(_resolvedRun, completion) {
                            return completion.result;
                        },
                        timing: null
                    }
                );

                scope.assert.equal(result.planStatus, 'empty-selection');
                scope.assert.equal(destroyed, true);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runWorkerPoolCommand() records child-host pool startup and shutdown timing',
            async body(scope: OverkillScope) {
                const timing = createRunTimingMeasurement(
                    createDeterministicClock({ initialUnixEpochMicroseconds: 0n })
                );
                const fixture = createRecordedPoolDependencies();
                const result = await runWorkerPoolCommand(
                    workerPoolCommand({ kind: 'child', nodeArguments: [ '--conditions=overkill-test' ] }),
                    fixture.dependencies,
                    async function createResolvedRun(collectionResult) {
                        return workerPoolResolvedRun(collectionResult.collectedPlan);
                    },
                    {
                        async finalizeResult(_resolvedRun, completion) {
                            return completion.result;
                        },
                        timing
                    }
                );

                scope.assert.equal(result.planStatus, 'empty-selection');
                scope.assert.deepEqual(
                    timing.report().spans.map(function toKind(span) {
                        return span.kind;
                    }),
                    [ 'worker-pool.start', 'worker-pool.ready', 'worker-pool.shutdown' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

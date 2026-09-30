import { createDeterministicClock } from '@enormora/clock';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { RunCollectionError } from './run-errors.ts';
import type {
    CreatedWorkerPool,
    RunOrchestratorDependencies,
    WorkerPoolCreationOptions,
    WorkerPoolHostOutputSink
} from './run-orchestrator-dependencies.ts';
import { createSupervisedRunState } from './supervised-run-state.ts';
import {
    createRunTimingMeasurement,
    type RunTimingMeasurement
} from './run-timing-collection.ts';
import type {
    WorkerPoolCollection,
    WorkerPoolCommand
} from './worker-pool-protocol.ts';
import { collectInWorkerPool } from './worker-pool-collection.ts';

type WorkerPoolFactory = RunOrchestratorDependencies['createWorkerPool'];
type TimeoutCallback = () => void;

type TestPoolOptions = {
    readonly destroy: () => Promise<void>;
    readonly run: (
        task: Parameters<CreatedWorkerPool['run']>[0],
        options: Parameters<CreatedWorkerPool['run']>[1],
        readHostOutputSink: () => WorkerPoolHostOutputSink | null
    ) => Promise<unknown>;
};

type InvalidOwnedPoolResult = {
    readonly destroyed: boolean;
    readonly options: WorkerPoolCreationOptions | null;
    readonly thrownError: unknown;
};

function workerPoolCommand(): WorkerPoolCommand {
    return {
        collectionTimeoutMilliseconds: 100,
        cwd: process.cwd(),
        definitionLocationCapture: 'disabled',
        engine: { kind: 'default' },
        hardTimeoutMilliseconds: 1000,
        maxConcurrency: 5,
        hostProcess: { kind: 'direct' },
        paths: [],
        resourceBudgets: {
            activeResourceCount: null,
            javaScriptEngineHeapBytes: null,
            residentSetBytes: null,
            residentSetGrowthBytesPerSecond: null
        },
        resourceUsageSamplingIntervalMilliseconds: 1,
        root: { annotations: {}, controls: {}, title: process.cwd() },
        scheduling: 'serial',
        testFamily: 'microtest',
        timeoutMilliseconds: 1000,
        workerLifecycle: 'fresh-worker-per-unit'
    };
}

function collectedPlan(): WorkerPoolCollection['collectedPlan'] {
    return {
        defined: 0,
        discoveredFiles: [],
        files: [],
        orphans: [],
        root: {
            annotations: { ownership: [], tags: [] },
            controls: { capture: null, duplicateExecution: null, timeoutMilliseconds: null },
            title: 'worker pool collection'
        }
    };
}

async function collection(): Promise<WorkerPoolCollection> {
    return {
        collectedPlan: collectedPlan(),
        runnerErrors: []
    };
}

function createTestPool(options: TestPoolOptions): CreatedWorkerPool {
    let hostOutputSink: WorkerPoolHostOutputSink | null = null;

    return {
        async destroy() {
            await options.destroy();
        },
        options: {
            isolateWorkers: true,
            maxThreads: 1
        },
        async run(task, runOptions) {
            return await options.run(task, runOptions, function readHostOutputSink() {
                return hostOutputSink;
            });
        },
        setHostOutputSink(sink) {
            hostOutputSink = sink;
        }
    };
}

function createDependencies(createWorkerPool: WorkerPoolFactory): RunOrchestratorDependencies {
    return {
        createWorkerPool,
        wallClock: {
            clearTimeout() {
                return undefined;
            },
            currentUnixEpochMilliseconds: 0,
            currentMonotonicMicroseconds: 0,
            setTimeout() {
                return 1;
            }
        }
    } as unknown as RunOrchestratorDependencies;
}

function createTimeoutDependencies(
    createWorkerPool: WorkerPoolFactory,
    writeTimeoutCallback: (callback: TimeoutCallback) => void
): RunOrchestratorDependencies {
    return {
        createWorkerPool,
        wallClock: {
            clearTimeout() {
                return undefined;
            },
            currentUnixEpochMilliseconds: 0,
            currentMonotonicMicroseconds: 0,
            setTimeout(callback: TimeoutCallback) {
                writeTimeoutCallback(callback);

                return 1;
            }
        }
    } as unknown as RunOrchestratorDependencies;
}

async function collectInvalidOwnedPool(timing: RunTimingMeasurement): Promise<InvalidOwnedPoolResult> {
    let destroyed = false;
    let options: WorkerPoolCreationOptions | null = null;
    let thrownError: unknown = null;

    try {
        await collectInWorkerPool({
            command: workerPoolCommand(),
            createdPool: null,
            dependencies: createDependencies(function createPool(poolOptions) {
                options = poolOptions;

                return createTestPool({
                    async destroy() {
                        destroyed = true;
                    },
                    async run() {
                        return {};
                    }
                });
            }),
            runState: createSupervisedRunState(),
            timing
        });
    } catch (error: unknown) {
        thrownError = error;
    }

    return { destroyed, options, thrownError };
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-collection.test.ts',
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'collectInWorkerPool() uses a provided pool without destroying it',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                let destroyed = false;
                const runState = createSupervisedRunState();
                const pool = createTestPool({
                    async destroy() {
                        destroyed = true;
                    },
                    async run(_task, _options, readHostOutputSink) {
                        readHostOutputSink()?.('stdout', new Uint8Array([ 65 ]));

                        return await collection();
                    }
                });
                const result = await collectInWorkerPool({
                    command: workerPoolCommand(),
                    createdPool: pool,
                    dependencies: createDependencies(function failCreateWorkerPool(): CreatedWorkerPool {
                        throw new Error('Expected provided pool.');
                    }),
                    runState,
                    timing: null
                });

                scope.assert.equal(result.collectedPlan.files.length, 0);
                scope.assert.equal(destroyed, false);
                scope.assert.equal(runState.artifacts().length, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'collectInWorkerPool() destroys owned pools after invalid collection results',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
                const timing = createRunTimingMeasurement(clock);
                const result = await collectInvalidOwnedPool(timing);

                scope.assert.equal(result.thrownError instanceof RunCollectionError, true);
                scope.assert.equal(result.options?.timing, timing);
                scope.assert.equal(result.destroyed, true);
                scope.assert.deepEqual(
                    timing.report().spans.map(function toKind(span) {
                        return span.kind;
                    }),
                    [ 'worker-pool.start', 'worker-pool.ready', 'worker-pool.shutdown' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'collectInWorkerPool() destroys owned pools after successful collection',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                let destroyed = false;
                let optionHasTiming = true;
                const result = await collectInWorkerPool({
                    command: workerPoolCommand(),
                    createdPool: null,
                    dependencies: createDependencies(function createPool(poolOptions) {
                        optionHasTiming = Object.hasOwn(poolOptions, 'timing');

                        return createTestPool({
                            async destroy() {
                                destroyed = true;
                            },
                            async run() {
                                return await collection();
                            }
                        });
                    }),
                    runState: createSupervisedRunState(),
                    timing: null
                });

                scope.assert.equal(result.collectedPlan.files.length, 0);
                scope.assert.equal(optionHasTiming, false);
                scope.assert.equal(destroyed, true);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'collectInWorkerPool() reports collection timeouts as terminal failures',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                let timeoutCallback: TimeoutCallback = function missingTimeoutCallback() {
                    throw new Error('Expected collection timeout.');
                };
                const runState = createSupervisedRunState();
                let thrownError: unknown = null;

                try {
                    await collectInWorkerPool({
                        command: workerPoolCommand(),
                        createdPool: createTestPool({
                            async destroy() {
                                return undefined;
                            },
                            async run() {
                                timeoutCallback();

                                return collection();
                            }
                        }),
                        dependencies: createTimeoutDependencies(
                            function failCreateWorkerPool(): CreatedWorkerPool {
                                throw new Error('Expected provided pool.');
                            },
                            function writeTimeoutCallback(callback) {
                                timeoutCallback = callback;
                            }
                        ),
                        runState,
                        timing: null
                    });
                } catch (error: unknown) {
                    thrownError = error;
                }

                scope.assert.equal(thrownError instanceof RunCollectionError, true);
                scope.assert.equal(
                    runState.runnerErrors()[0]?.message,
                    'Worker-pool collection exceeded collection timeout.'
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

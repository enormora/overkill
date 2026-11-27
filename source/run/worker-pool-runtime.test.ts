import { suite, test } from '@overkill-dev/test';
import {
    defaultIntegrationProfile,
    defaultRunConfig,
    defaultRunRequest,
    testRunExecutionFacts
} from '../test-support/run-command-factory.ts';
import { fakeWorkerPoolRuntimeDependencies as fakeDependencies } from '../test-support/worker-pool-runtime-fixtures.ts';
import type { WorkerLifecycle } from '../config/types.ts';
import {
    createCollectedPlan,
    workerPoolResolvedRun,
    type CollectedRunPlan,
    type ResolvedRun
} from '../test-support/worker-pool-runtime-fixture.ts';
import type { WorkerPoolCreationOptions } from './run-orchestrator-dependencies.ts';
import { createSupervisedRunState } from './supervised-run-state.ts';
import {
    createWorkerPoolRuntime,
    workerPoolPlacementPlan,
    workerPoolExecutionFacts,
    type WorkerPoolRunRuntime
} from './worker-pool-runtime.ts';

type RecordedPoolDependencies = {
    readonly createdWorkerPools: readonly WorkerPoolCreationOptions[];
    readonly dependencies: WorkerPoolRunRuntime['dependencies'];
    readonly measuredSamplingInterval: () => number;
};

function collectedPlanWithRunResource(): CollectedRunPlan {
    const plan = createCollectedPlan();
    const firstFile = plan.files[0];
    const firstCase = firstFile?.cases[0];

    if (firstFile === undefined || firstCase === undefined) {
        throw new Error('Run-resource fixture requires one file-backed case.');
    }

    return {
        ...plan,
        files: [
            {
                ...firstFile,
                cases: [
                    {
                        ...firstCase,
                        resourceAttachments: {
                            ...firstCase.resourceAttachments,
                            resourceGraph: [
                                {
                                    workload: 'independent' as const,
                                    dependencies: [],
                                    handleTransport: 'local',
                                    name: 'database',
                                    requirements: [],
                                    scenarios: [],
                                    scope: 'per-run'
                                }
                            ]
                        }
                    }
                ]
            }
        ]
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
                processUsagePolicy: {
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

function workerPoolResolvedRunWithLifecycle(workerLifecycle: WorkerLifecycle): ResolvedRun {
    const resolvedRun = workerPoolResolvedRun(createCollectedPlan());

    if (resolvedRun.facts.execution.processModel !== 'worker-pool') {
        throw new Error('Worker-pool lifecycle test requires worker-pool execution facts.');
    }

    const { placementPlan } = resolvedRun.facts.execution;

    if (placementPlan === null) {
        throw new Error('Worker-pool lifecycle test requires a placement plan.');
    }

    return {
        ...resolvedRun,
        facts: {
            ...resolvedRun.facts,
            execution: {
                ...resolvedRun.facts.execution,
                placementPlan: {
                    ...placementPlan,
                    units: placementPlan.units.map(function toLifecycleUnit(unit) {
                        return { ...unit, workerLifecycle };
                    })
                },
                workerLifecycle
            }
        }
    };
}

function childHostResolvedRun(): ResolvedRun {
    const resolvedRun = workerPoolResolvedRunWithLifecycle('fresh-worker-per-unit');

    if (resolvedRun.facts.execution.processModel !== 'worker-pool') {
        throw new Error('Worker-pool child host test requires worker-pool execution facts.');
    }

    return {
        ...resolvedRun,
        facts: {
            ...resolvedRun.facts,
            execution: {
                ...resolvedRun.facts.execution,
                hostProcess: {
                    kind: 'child',
                    nodeArguments: [ '--conditions=overkill-test' ],
                    reasons: [ 'node-arguments' ]
                }
            }
        }
    };
}

function supervisedExecutionFacts(): ResolvedRun['facts']['execution'] {
    const command = {
        config: defaultRunConfig(),
        cwd: process.cwd(),
        engine: { kind: 'default' as const },
        request: defaultRunRequest({ profile: 'integration' })
    };
    return {
        ...testRunExecutionFacts(
            command,
            defaultIntegrationProfile({
                execution: { processModel: 'supervised-process', scheduling: 'serial' },
                timeouts: { collectionMilliseconds: 1000, hardMilliseconds: 1000, softMilliseconds: 500 }
            })
        ),
        attachments: null
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

function workerPoolRunWithoutPlacementPlan(): ResolvedRun {
    const resolvedRun = workerPoolResolvedRun(createCollectedPlan());

    return {
        ...resolvedRun,
        facts: {
            ...resolvedRun.facts,
            execution: {
                ...resolvedRun.facts.execution,
                placementPlan: null
            }
        }
    };
}

async function createRuntime(
    dependencies: WorkerPoolRunRuntime['dependencies'],
    resolvedRun: ResolvedRun
): Promise<WorkerPoolRunRuntime> {
    return await createWorkerPoolRuntime({
        attachments: null,
        collectionRunnerErrors: [],
        createdPool: null,
        dependencies,
        async finalizeResult(completion) {
            return completion.result;
        },
        resolvedRun,
        runState: createSupervisedRunState('first-failure-and-final')
    });
}

function failProcessUsageFinish(): never {
    throw new Error('Process usage tracker should not finish in this test.');
}

function createRecordedPoolDependencies(): RecordedPoolDependencies {
    const createdWorkerPools: WorkerPoolCreationOptions[] = [];
    let measuredSamplingInterval = 0;
    const baseDependencies = fakeDependencies();

    return {
        createdWorkerPools,
        dependencies: {
            ...baseDependencies,
            createProcessUsageTracker(options) {
                measuredSamplingInterval = options.samplingIntervalMilliseconds;

                return {
                    finish: failProcessUsageFinish,
                    start() {
                        return undefined;
                    }
                };
            },
            createWorkerPool(options) {
                createdWorkerPools.push(options);

                return baseDependencies.createWorkerPool(options);
            }
        },
        measuredSamplingInterval() {
            return measuredSamplingInterval;
        }
    };
}

async function workerPoolRuntimeCreation(): Promise<{
    readonly createdWorkerPools: readonly WorkerPoolCreationOptions[];
    readonly measuredSamplingInterval: number;
    readonly measuredThreads: number;
    readonly measuredTracker: WorkerPoolRunRuntime['poolProcessUsageTracker'];
    readonly unmeasuredThreads: number;
    readonly unmeasuredTracker: WorkerPoolRunRuntime['poolProcessUsageTracker'];
}> {
    const fixture = createRecordedPoolDependencies();
    const unmeasuredRuntime = await createRuntime(
        fixture.dependencies,
        workerPoolResolvedRun({ ...createCollectedPlan(), files: [] })
    );
    const measuredRuntime = await createRuntime(fixture.dependencies, resourceMeasurementResolvedRun());
    const freshRuntime = await createRuntime(fixture.dependencies, childHostResolvedRun());

    await unmeasuredRuntime.pool.destroy();
    await measuredRuntime.pool.destroy();
    await freshRuntime.pool.destroy();

    return {
        createdWorkerPools: fixture.createdWorkerPools,
        measuredSamplingInterval: fixture.measuredSamplingInterval(),
        measuredThreads: measuredRuntime.pool.options.maxThreads,
        measuredTracker: measuredRuntime.poolProcessUsageTracker,
        unmeasuredThreads: unmeasuredRuntime.pool.options.maxThreads,
        unmeasuredTracker: unmeasuredRuntime.poolProcessUsageTracker
    };
}

export const testNode = suite('Worker pool runtime', [
    test(
        'worker-pool runtime creation sizes pools and installs process usage tracking',
        async function (scope) {
            const result = await workerPoolRuntimeCreation();

            scope.assert.equal(result.unmeasuredThreads, 0);
            scope.assert.equal(result.unmeasuredTracker, null);
            scope.assert.equal(result.measuredThreads, 1);
            scope.assert.equal(result.measuredSamplingInterval, 17);
            scope.assert.notEqual(result.measuredTracker, null);
            scope.assert.deepEqual(result.createdWorkerPools, [
                {
                    cwd: process.cwd(),
                    hostProcess: { kind: 'direct' },
                    testFamily: 'integration',
                    workerCount: 0,
                    workerLifecycle: 'reuse'
                },
                {
                    cwd: process.cwd(),
                    hostProcess: { kind: 'direct' },
                    testFamily: 'integration',
                    workerCount: 1,
                    workerLifecycle: 'reuse'
                },
                {
                    cwd: process.cwd(),
                    hostProcess: { kind: 'child', nodeArguments: [ '--conditions=overkill-test' ] },
                    testFamily: 'integration',
                    workerCount: 1,
                    workerLifecycle: 'fresh-worker-per-unit'
                }
            ]);

            return scope.assert.collect();
        }
    ),
    test('one reusable lane owns per-run resources without another worker', async function (scope) {
        const fixture = createRecordedPoolDependencies();
        const runtime = await createRuntime(
            fixture.dependencies,
            workerPoolResolvedRun(collectedPlanWithRunResource())
        );

        scope.assert.equal(runtime.pool.options.maxThreads, 1);
        scope.assert.deepEqual(fixture.createdWorkerPools, [
            {
                cwd: process.cwd(),
                hostProcess: { kind: 'direct' },
                testFamily: 'integration',
                workerCount: 1,
                workerLifecycle: 'reuse'
            }
        ]);
        await runtime.pool.destroy();

        return scope.assert.collect();
    }),
    test('worker-pool runtime creation rejects non-worker-pool facts', async function (scope) {
        await scope.assert.rejects(async function createMismatchedRuntime() {
            await createWorkerPoolRuntime({
                attachments: null,
                collectionRunnerErrors: [],
                createdPool: null,
                dependencies: fakeDependencies(),
                async finalizeResult(completion) {
                    return completion.result;
                },
                resolvedRun: workerPoolPlanWithSupervisedFacts(),
                runState: createSupervisedRunState('first-failure-and-final')
            });
        }, {
            message: 'Worker-pool execution requires worker-pool execution facts.'
        });
        scope.assert.throws(function readMismatchedExecutionFacts() {
            workerPoolExecutionFacts(workerPoolPlanWithSupervisedFacts());
        }, { message: 'Worker-pool execution requires worker-pool execution facts.' });

        return scope.assert.collect();
    }),
    test('worker-pool runtime rejects missing placement plans', function (scope) {
        scope.assert.throws(function readMissingPlacementPlan() {
            workerPoolPlacementPlan(workerPoolRunWithoutPlacementPlan());
        }, { message: 'Worker-pool execution requires a placement plan.' });

        return scope.assert.collect();
    })
]);

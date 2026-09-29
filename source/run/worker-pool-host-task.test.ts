import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { readWorkerPoolTaskWithoutPort } from './worker-pool-host-task.ts';
import type {
    WorkerPoolCommand,
    WorkerPoolTask
} from './worker-pool-protocol.ts';

type WorkerPoolTaskBase = Pick<
    Extract<WorkerPoolTask, { readonly kind: 'acquire-run-resources'; }>,
    'assignedWork' | 'boundaryUseCounts' | 'command' | 'lane' | 'lifecycle' | 'port'
>;
type TestWorkId = WorkerPoolTaskBase['assignedWork'][number];

const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
} as const;

const { port1: port } = new MessageChannel();

port.unref();

function workId(): TestWorkId {
    return {
        case: {
            file: 'test.ts',
            params: null,
            suite: [],
            title: 'first'
        },
        runtimes: [],
        workload: null
    };
}

function command(): WorkerPoolCommand {
    return {
        collectionTimeoutMilliseconds: 100,
        cwd: '/project',
        definitionLocationCapture: 'enabled',
        engine: { kind: 'default' },
        hardTimeoutMilliseconds: 200,
        hostProcess: { kind: 'child', nodeArguments: [] },
        paths: [ 'test.ts' ],
        resourceBudgets: {
            activeResourceCount: null,
            javaScriptEngineHeapBytes: null,
            residentSetBytes: null,
            residentSetGrowthBytesPerSecond: null
        },
        resourceUsageSamplingIntervalMilliseconds: 10,
        scheduling: 'serial',
        testFamily: 'integration',
        timeoutMilliseconds: 100,
        workerLifecycle: 'reuse'
    };
}

function taskBase(): WorkerPoolTaskBase {
    return {
        assignedWork: [ workId() ],
        boundaryUseCounts: [ { boundaryKey: 'run:database', count: 1 } ],
        command: command(),
        lane: 'worker-1',
        lifecycle: { token: 'lifecycle-1' },
        port
    };
}

function runTask(): WorkerPoolTask {
    return {
        ...taskBase(),
        assignedUnits: [ {
            attempt: 'attempt-1',
            traceUnit: {
                key: 'test.ts',
                mode: 'case',
                runtimes: [],
                workload: null
            },
            work: [ workId() ]
        } ],
        kind: 'run',
        projectedResources: { resources: [ { boundaryKey: 'run:database', payload: 'connection' } ] },
        runWork: [ workId() ],
        startedAtMilliseconds: 25
    };
}

function acquireRunResourcesTask(): WorkerPoolTask {
    return {
        ...taskBase(),
        boundaryKeys: [ 'run:database' ],
        kind: 'acquire-run-resources'
    };
}

function disposeRunResourcesTask(): WorkerPoolTask {
    return {
        kind: 'dispose-run-resources',
        lane: 'worker-1',
        lifecycle: { token: 'lifecycle-1' },
        port
    };
}

function completeResourceOwnerWorkTask(): WorkerPoolTask {
    return {
        boundaryKeys: [ 'file:test.ts:database' ],
        kind: 'complete-resource-owner-work',
        lane: 'worker-1',
        lifecycle: { token: 'lifecycle-1' },
        port
    };
}

function disposeLaneLifecycleTask(): WorkerPoolTask {
    return {
        kind: 'dispose-lane-lifecycle',
        lane: 'worker-1',
        lifecycle: { token: 'lifecycle-1' },
        port
    };
}

function collectTask(): WorkerPoolTask {
    return {
        command: command(),
        kind: 'collect',
        port
    };
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-host-task.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'readWorkerPoolTaskWithoutPort() serializes every task kind',
            body(scope: OverkillScope) {
                const tasks = [
                    collectTask(),
                    acquireRunResourcesTask(),
                    completeResourceOwnerWorkTask(),
                    disposeRunResourcesTask(),
                    disposeLaneLifecycleTask(),
                    runTask()
                ];

                scope.assert.deepEqual(tasks.map(readWorkerPoolTaskWithoutPort), [
                    { command: command(), kind: 'collect' },
                    {
                        assignedWork: [ workId() ],
                        boundaryKeys: [ 'run:database' ],
                        boundaryUseCounts: [ { boundaryKey: 'run:database', count: 1 } ],
                        command: command(),
                        kind: 'acquire-run-resources',
                        lane: 'worker-1',
                        lifecycle: { token: 'lifecycle-1' }
                    },
                    {
                        boundaryKeys: [ 'file:test.ts:database' ],
                        kind: 'complete-resource-owner-work',
                        lane: 'worker-1',
                        lifecycle: { token: 'lifecycle-1' }
                    },
                    {
                        kind: 'dispose-run-resources',
                        lane: 'worker-1',
                        lifecycle: { token: 'lifecycle-1' }
                    },
                    {
                        kind: 'dispose-lane-lifecycle',
                        lane: 'worker-1',
                        lifecycle: { token: 'lifecycle-1' }
                    },
                    {
                        assignedUnits: [ {
                            attempt: 'attempt-1',
                            traceUnit: {
                                key: 'test.ts',
                                mode: 'case',
                                runtimes: [],
                                workload: null
                            },
                            work: [ workId() ]
                        } ],
                        assignedWork: [ workId() ],
                        boundaryUseCounts: [ { boundaryKey: 'run:database', count: 1 } ],
                        command: command(),
                        kind: 'run',
                        lane: 'worker-1',
                        lifecycle: { token: 'lifecycle-1' },
                        projectedResources: { resources: [ { boundaryKey: 'run:database', payload: 'connection' } ] },
                        runWork: [ workId() ],
                        startedAtMilliseconds: 25
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'readWorkerPoolTaskWithoutPort() rejects invalid tasks',
            body(scope: OverkillScope) {
                scope.assert.throws(function readInvalidTask() {
                    readWorkerPoolTaskWithoutPort({ kind: 'collect' });
                }, {
                    message: 'Hosted worker-pool received an invalid task.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

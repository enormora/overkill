import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestBody, type TestNode, suite, test, createTestFacade } from '@overkill-dev/test';
import { defineResource, withResources, type ResourceDefinition } from '@overkill-dev/test/resources';
import { subjectTestNode } from '../test-support/create-test-engine.ts';

import {
    defaultFailureArtifactPolicy,
    type TestPlan,
    type TestNode as SubjectTestNode,
    type WorkId,
    createRoot,
    createTestPlan
} from '../packages/engine/engine.entry-point.ts';

import type { EmptyResourceDependencies } from '../resources/resources.ts';
import { createWorkerProcessUsageTracker } from './worker-execution-engine.ts';
import type { WorkerPoolCommand, WorkerPoolLifecycleIdentity, WorkerPoolTask } from './worker-pool-protocol.ts';
import {
    acquireWorkerRunResources,
    disposeWorkerLaneLifecycle,
    disposeWorkerRunResources,
    laneResourceSession
} from './worker-pool-worker-resources.ts';

type CollectedWorkerPlan = {
    readonly runnerErrors: readonly [];
    readonly testPlan: TestPlan;
};
type RunTask = Extract<WorkerPoolTask, { readonly kind: 'run'; }>;
type AcquireRunResourcesTask = Extract<WorkerPoolTask, { readonly kind: 'acquire-run-resources'; }>;
type DisposeRunResourcesTask = Extract<WorkerPoolTask, { readonly kind: 'dispose-run-resources'; }>;
type DisposeLaneLifecycleTask = Extract<WorkerPoolTask, { readonly kind: 'dispose-lane-lifecycle'; }>;
type DatabaseHandle = {
    readonly url: string;
};
type DatabaseResource = ResourceDefinition<'database', DatabaseHandle, EmptyResourceDependencies, DatabaseHandle>;
type ScratchResource = ResourceDefinition<'scratch', string, EmptyResourceDependencies>;
type EventLog = {
    readonly add: (event: string) => void;
    readonly values: () => readonly string[];
};

const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
} as const;

const { port1: port } = new MessageChannel();

port.unref();

function createEventLog(): EventLog {
    const events: string[] = [];

    return {
        add(event) {
            events.push(event);
        },
        values() {
            return events;
        }
    };
}

function command(): WorkerPoolCommand {
    return {
        implementations: null,
        implementationContext: { projectRoot: '/project' },

        family: null,
        debug: { mode: 'off', selectors: [] },
        failureArtifacts: defaultFailureArtifactPolicy,
        capture: 'buffered',
        replay: null,
        snapshots: null,
        seed: '0',
        benchmarkNormalization: null,
        benchmarkGarbageCollection: null,
        propertyPolicy: null,
        attachmentEndpoint: null,
        retryPolicy: null,
        collectionTimeoutMilliseconds: 100,
        cwd: '/project',
        definitionLocationCapture: 'enabled',
        engine: { kind: 'default' },
        hardTimeoutMilliseconds: 200,
        maxConcurrency: 5,
        hostProcess: { kind: 'child', nodeArguments: [] },
        paths: [ 'test.ts' ],
        processBudgets: {
            activeResourceCount: null,
            javaScriptEngineHeapBytes: null,
            residentSetBytes: null,
            residentSetGrowthBytesPerSecond: null
        },
        processUsageSamplingIntervalMilliseconds: 10,
        root: { annotations: {}, controls: {}, title: process.cwd() },
        scheduling: 'serial',
        testFamily: 'integration',
        timeoutMilliseconds: 100,
        workerLifecycle: 'reuse'
    };
}

function projectedDatabaseResource(events: EventLog): DatabaseResource {
    return defineResource({
        name: 'database',
        scope: 'per-run',
        requirements: [],
        acquire(): DatabaseHandle {
            events.add('acquire');

            return { url: 'postgres://localhost' };
        },
        dispose(handle) {
            events.add(`dispose:${handle.url}`);
        },
        serializeHandle(handle) {
            return handle.url;
        },
        deserializeHandle(payload) {
            return { url: payload };
        }
    });
}

function failingDatabaseResource(): DatabaseResource {
    return defineResource({
        name: 'database',
        scope: 'per-run',
        requirements: [],
        acquire(): DatabaseHandle {
            throw new Error('database unavailable');
        },
        dispose: null,
        serializeHandle(): string {
            return 'unused';
        },
        deserializeHandle() {
            return { url: 'unused' };
        }
    });
}

function laneScratchResource(events: EventLog): ScratchResource {
    return defineResource({
        name: 'scratch',
        scope: 'per-case',
        requirements: [],
        acquire() {
            events.add('acquire:scratch');

            return 'scratch';
        },
        dispose(handle) {
            events.add(`dispose:${handle}`);
        }
    });
}

function collectedWorkerPlanFromNode(testNode: SubjectTestNode | TestNode): CollectedWorkerPlan {
    const testPlan = createTestPlan(createRoot({
        ...testCaseMetadata,
        children: [
            subjectTestNode(testNode)
        ],
        title: 'worker resources'
    }));

    return { runnerErrors: [], testPlan };
}

function collectedWorkerPlan(body: TestBody): CollectedWorkerPlan {
    return collectedWorkerPlanFromNode(test({
        ...testCaseMetadata,
        body,
        title: 'uses resources'
    }));
}

function firstWorkId(plan: CollectedWorkerPlan): WorkId {
    return plan.testPlan.cases[0].workId;
}

function acquireTask(plan: CollectedWorkerPlan, lifecycle: WorkerPoolLifecycleIdentity): AcquireRunResourcesTask {
    return {
        workloadInputs: [],
        assignedWork: [ firstWorkId(plan) ],
        boundaryKeys: [ 'run:database' ],
        boundaryUseCounts: [],
        command: command(),
        kind: 'acquire-run-resources',
        lane: 'worker-1',
        lifecycle,
        port
    };
}

function disposeRunTask(lifecycle: WorkerPoolLifecycleIdentity): DisposeRunResourcesTask {
    return {
        kind: 'dispose-run-resources',
        lane: 'worker-1',
        lifecycle,
        port
    };
}

function runTask(plan: CollectedWorkerPlan, lifecycle: WorkerPoolLifecycleIdentity): RunTask {
    const workId = firstWorkId(plan);

    return {
        workloadInputs: [],
        assignedUnits: [
            {
                attempt: 'attempt-1',
                traceUnit: { familyVariant: null, key: 'test.ts', mode: 'case', runtimes: [], workload: null },
                work: [ workId ]
            }
        ],
        assignedWork: [ workId ],
        boundaryUseCounts: [],
        command: command(),
        kind: 'run',
        lane: 'worker-1',
        lifecycle,
        port,
        projectedResources: { resources: [] },
        runWork: [ workId ],
        startedAtMilliseconds: 25
    };
}

function disposeLaneTask(lifecycle: WorkerPoolLifecycleIdentity): DisposeLaneLifecycleTask {
    return {
        kind: 'dispose-lane-lifecycle',
        lane: 'worker-1',
        lifecycle,
        port
    };
}

const assertRunResourcesAcquireAndDispose = defineCompositeAssertion({
    name: 'run resources acquire and dispose',
    async assert(check) {
        const events = createEventLog();
        const lifecycle = { endpoint: null, token: 'acquire-dispose' };
        const database = projectedDatabaseResource(events);
        const plan = collectedWorkerPlan(withResources({ database }, function testBody(resourceScope) {
            resourceScope.assert.equal(resourceScope.resources.database.url, 'postgres://localhost');

            return resourceScope.assert.collect();
        }));
        return check.group([
            check.deepEqual(await acquireWorkerRunResources(acquireTask(plan, lifecycle), plan, null), {
                projectedResources: { resources: [ { boundaryKey: 'run:database', payload: 'postgres://localhost' } ] },
                runnerErrors: []
            }),
            check.deepEqual(await disposeWorkerRunResources(disposeRunTask(lifecycle)), { runnerErrors: [] }),
            check.deepEqual(events.values(), [ 'acquire', 'dispose:postgres://localhost' ])
        ]);
    }
});

const assertRunResourceFailuresBecomeRunnerErrors = defineCompositeAssertion({
    name: 'run resource failures become runner errors',
    async assert(check) {
        const database = failingDatabaseResource();
        const lifecycle = { endpoint: null, token: 'failing-acquire' };
        const plan = collectedWorkerPlan(withResources({ database }, function testBody(resourceScope) {
            return resourceScope.assert.collect();
        }));
        const output = await acquireWorkerRunResources(acquireTask(plan, lifecycle), plan, null);
        return check.group([
            check.deepEqual(output.projectedResources, { resources: [] }),
            check.equal(output.runnerErrors[0]?.message, 'Resource acquisition failed.'),
            check.equal(output.runnerErrors[0]?.subtype, 'runtime-policy')
        ]);
    }
});

const assertPlainBodiesDoNotAcquireRunResources = defineCompositeAssertion({
    name: 'plain bodies do not acquire run resources',
    async assert(check) {
        const lifecycle = { endpoint: null, token: 'plain-body' };
        const plan = collectedWorkerPlan(function testBody(resourceScope) {
            return resourceScope.assert.collect();
        });
        const output = await acquireWorkerRunResources(acquireTask(plan, lifecycle), plan, null);
        return check.group([
            check.deepEqual(output, {
                projectedResources: { resources: [] },
                runnerErrors: []
            }),
            check.deepEqual(await disposeWorkerRunResources(disposeRunTask({ endpoint: null, token: 'missing-run' })), {
                runnerErrors: []
            }),
            check.deepEqual(await disposeWorkerRunResources(disposeRunTask(lifecycle)), { runnerErrors: [] })
        ]);
    }
});

const assertScopeWrappersDoNotAcquireRunResources = defineCompositeAssertion({
    name: 'scope wrappers do not acquire run resources',
    async assert(check) {
        const lifecycle = { endpoint: null, token: 'scope-wrapper' };
        const facade = createTestFacade({
            mapScope() {
                return { project: 'fixture' };
            }
        });
        const plan = collectedWorkerPlanFromNode(facade.test('uses mapped scope', function testBody(facadeScope) {
            facadeScope.assert.equal(facadeScope.project, 'fixture');

            return facadeScope.assert.collect();
        }));
        const output = await acquireWorkerRunResources(acquireTask(plan, lifecycle), plan, null);
        return check.group([ check.deepEqual(output, {
            projectedResources: { resources: [] },
            runnerErrors: []
        }) ]);
    }
});

const assertLaneSessionsAreReusedAndDisposed = defineCompositeAssertion({
    name: 'lane sessions are reused and disposed',
    async assert(check) {
        const events = createEventLog();
        const lifecycle = { endpoint: null, token: 'lane-session' };
        const scratch = laneScratchResource(events);
        const plan = collectedWorkerPlan(withResources({ scratch }, function testBody(resourceScope) {
            return resourceScope.assert.collect();
        }));
        const task = runTask(plan, lifecycle);
        const firstSession = laneResourceSession(task, plan, null);
        const secondSession = laneResourceSession(task, plan, null);
        return check.group([
            check.equal(firstSession, secondSession),
            check.deepEqual(await disposeWorkerLaneLifecycle(disposeLaneTask(lifecycle)), { runnerErrors: [] }),
            check.deepEqual(await disposeWorkerLaneLifecycle(disposeLaneTask(lifecycle)), { runnerErrors: [] })
        ]);
    }
});

export const testNode = suite({
    ...testCaseMetadata,
    title: 'Worker pool worker resources',
    children: [
        test({
            ...testCaseMetadata,
            title: 'acquire projected run resources',
            async body(scope) {
                await scope.assert(assertRunResourcesAcquireAndDispose);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'record acquisition failures',
            async body(scope) {
                await scope.assert(assertRunResourceFailuresBecomeRunnerErrors);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'ignore plain test bodies',
            async body(scope) {
                await scope.assert(assertPlainBodiesDoNotAcquireRunResources);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'ignore mapped scope wrappers',
            async body(scope) {
                await scope.assert(assertScopeWrappersDoNotAcquireRunResources);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'reuse lane sessions',
            async body(scope) {
                await scope.assert(assertLaneSessionsAreReusedAndDisposed);
                createWorkerProcessUsageTracker(command());

                return scope.assert.collect();
            }
        })
    ]
});

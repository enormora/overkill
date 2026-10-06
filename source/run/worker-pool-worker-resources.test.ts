import {
    createRoot,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    createTestPlan,
    type TestPlan,
    type TestCaseOptions,
    type TestNode,
    type TestScope as OverkillScope,
    type WorkId
} from '../packages/engine/engine.entry-point.ts';
import { createTestFacade } from '../packages/test/test.entry-point.ts';
import {
    defineResource,
    withResources,
    type ResourceDefinition
} from '../packages/test/resources.entry-point.ts';
import type { EmptyResourceDependencies } from '../resources/resources.ts';
import type {
    WorkerPoolCommand,
    WorkerPoolLifecycleIdentity,
    WorkerPoolTask
} from './worker-pool-protocol.ts';
import {
    acquireWorkerRunResources,
    createWorkerResourceUsageTracker,
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
        resourceBudgets: {
            activeResourceCount: null,
            javaScriptEngineHeapBytes: null,
            residentSetBytes: null,
            residentSetGrowthBytesPerSecond: null
        },
        resourceUsageSamplingIntervalMilliseconds: 10,
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

function collectedWorkerPlanFromNode(testNode: TestNode): CollectedWorkerPlan {
    const testPlan = createTestPlan(createRoot({
        ...testCaseMetadata,
        children: [
            testNode
        ],
        title: 'worker resources'
    }));

    return { runnerErrors: [], testPlan };
}

function collectedWorkerPlan(body: TestCaseOptions['body']): CollectedWorkerPlan {
    return collectedWorkerPlanFromNode(createOverkillTestCase({
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
        assignedUnits: [
            {
                attempt: 'attempt-1',
                traceUnit: {
                    key: 'test.ts',
                    mode: 'case',
                    runtimes: [],
                    workload: null
                },
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

async function assertRunResourcesAcquireAndDispose(scope: OverkillScope): Promise<void> {
    const events = createEventLog();
    const lifecycle = { token: 'acquire-dispose' };
    const database = projectedDatabaseResource(events);
    const plan = collectedWorkerPlan(withResources({ database }, function testBody(resourceScope) {
        resourceScope.assert.equal(resourceScope.resources.database.url, 'postgres://localhost');

        return resourceScope.assert.collect();
    }));

    scope.assert.deepEqual(await acquireWorkerRunResources(acquireTask(plan, lifecycle), plan, null), {
        projectedResources: { resources: [ { boundaryKey: 'run:database', payload: 'postgres://localhost' } ] },
        runnerErrors: []
    });
    scope.assert.deepEqual(await disposeWorkerRunResources(disposeRunTask(lifecycle)), { runnerErrors: [] });
    scope.assert.deepEqual(events.values(), [ 'acquire', 'dispose:postgres://localhost' ]);
}

async function assertRunResourceFailuresBecomeRunnerErrors(scope: OverkillScope): Promise<void> {
    const database = failingDatabaseResource();
    const lifecycle = { token: 'failing-acquire' };
    const plan = collectedWorkerPlan(withResources({ database }, function testBody(resourceScope) {
        return resourceScope.assert.collect();
    }));
    const output = await acquireWorkerRunResources(acquireTask(plan, lifecycle), plan, null);

    scope.assert.deepEqual(output.projectedResources, { resources: [] });
    scope.assert.equal(output.runnerErrors[0]?.message, 'Resource acquisition failed.');
    scope.assert.equal(output.runnerErrors[0]?.subtype, 'runtime-policy');
}

async function assertPlainBodiesDoNotAcquireRunResources(scope: OverkillScope): Promise<void> {
    const lifecycle = { token: 'plain-body' };
    const plan = collectedWorkerPlan(function testBody(resourceScope) {
        return resourceScope.assert.collect();
    });
    const output = await acquireWorkerRunResources(acquireTask(plan, lifecycle), plan, null);

    scope.assert.deepEqual(output, {
        projectedResources: { resources: [] },
        runnerErrors: []
    });
    scope.assert.deepEqual(await disposeWorkerRunResources(disposeRunTask({ token: 'missing-run' })), {
        runnerErrors: []
    });
    scope.assert.deepEqual(await disposeWorkerRunResources(disposeRunTask(lifecycle)), { runnerErrors: [] });
}

async function assertScopeWrappersDoNotAcquireRunResources(scope: OverkillScope): Promise<void> {
    const lifecycle = { token: 'scope-wrapper' };
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

    scope.assert.deepEqual(output, {
        projectedResources: { resources: [] },
        runnerErrors: []
    });
}

async function assertLaneSessionsAreReusedAndDisposed(scope: OverkillScope): Promise<void> {
    const events = createEventLog();
    const lifecycle = { token: 'lane-session' };
    const scratch = laneScratchResource(events);
    const plan = collectedWorkerPlan(withResources({ scratch }, function testBody(resourceScope) {
        return resourceScope.assert.collect();
    }));
    const task = runTask(plan, lifecycle);
    const firstSession = laneResourceSession(task, plan, null);
    const secondSession = laneResourceSession(task, plan, null);

    scope.assert.equal(firstSession, secondSession);
    scope.assert.deepEqual(await disposeWorkerLaneLifecycle(disposeLaneTask(lifecycle)), { runnerErrors: [] });
    scope.assert.deepEqual(await disposeWorkerLaneLifecycle(disposeLaneTask(lifecycle)), { runnerErrors: [] });
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-worker-resources.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool worker resources acquire projected run resources',
            async body(scope: OverkillScope) {
                await assertRunResourcesAcquireAndDispose(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool worker resources record acquisition failures',
            async body(scope: OverkillScope) {
                await assertRunResourceFailuresBecomeRunnerErrors(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool worker resources ignore plain test bodies',
            async body(scope: OverkillScope) {
                await assertPlainBodiesDoNotAcquireRunResources(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool worker resources ignore mapped scope wrappers',
            async body(scope: OverkillScope) {
                await assertScopeWrappersDoNotAcquireRunResources(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool worker resources reuse lane sessions',
            async body(scope: OverkillScope) {
                await assertLaneSessionsAreReusedAndDisposed(scope);
                createWorkerResourceUsageTracker(command());

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

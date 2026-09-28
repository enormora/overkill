import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { ResourceScope } from '../resources/resources.ts';
import {
    acquireWorkerPoolResourceLifecycle,
    disposeWorkerPoolResourceLifecycles
} from './worker-pool-resource-lifecycle-execution.ts';
import {
    createCollectedPlan,
    fakeWorkerRuntime
} from './worker-pool-execution-state.test.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';

type CollectedRunPlan = WorkerPoolRunRuntime['collectedPlan'];
type PlacementPlan = NonNullable<WorkerPoolRunRuntime['resolvedRun']['facts']['execution']['placementPlan']>;
type ResourceSummary =
    CollectedRunPlan['files'][number]['cases'][number]['resourceAttachments']['resourceGraph'][number];

const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
} as const;

function resource(name: string, scope: ResourceScope): ResourceSummary {
    return {
        dependencies: [],
        name,
        requirements: [],
        scope
    };
}

function collectedPlanWithResources(resourceGraph: readonly ResourceSummary[]): CollectedRunPlan {
    const collectedPlan = createCollectedPlan();
    const firstFile = collectedPlan.files[0];
    const firstCase = firstFile?.cases[0];

    if (firstFile === undefined || firstCase === undefined) {
        throw new Error('Collected plan fixture requires one file-backed case.');
    }

    return {
        ...collectedPlan,
        files: [
            {
                ...firstFile,
                cases: [
                    {
                        ...firstCase,
                        resourceAttachments: {
                            ...firstCase.resourceAttachments,
                            resourceGraph
                        }
                    }
                ]
            }
        ]
    };
}

function placementPlan(runtime: WorkerPoolRunRuntime): PlacementPlan {
    const plan = runtime.resolvedRun.facts.execution.placementPlan;

    if (plan === null) {
        throw new Error('Worker-pool runtime fixture requires a placement plan.');
    }

    return plan;
}

function runtimeWithPoolRun(
    collectedPlan: CollectedRunPlan,
    run: WorkerPoolRunRuntime['pool']['run']
): WorkerPoolRunRuntime {
    const runtime = fakeWorkerRuntime(collectedPlan);

    return {
        ...runtime,
        pool: {
            ...runtime.pool,
            run
        }
    };
}

function readTaskKind(task: unknown): string {
    const kind: unknown = typeof task === 'object' && task !== null ? Reflect.get(task, 'kind') : null;

    if (typeof kind !== 'string') {
        throw new TypeError('Expected a worker-pool task kind.');
    }

    return kind;
}

function readTaskLane(task: unknown): string {
    const lane: unknown = typeof task === 'object' && task !== null ? Reflect.get(task, 'lane') : null;

    if (typeof lane !== 'string') {
        throw new TypeError('Expected a worker-pool task lane.');
    }

    return lane;
}

async function assertPerRunResourcesUseOwner(scope: OverkillScope): Promise<void> {
    const runtime = runtimeWithPoolRun(
        collectedPlanWithResources([ resource('database', 'per-run') ]),
        async function runResourceTask(task) {
            scope.assert.equal(readTaskKind(task), 'acquire-run-resources');

            return {
                projectedResources: {
                    resources: [ { boundaryKey: 'run:database', payload: 'database-handle' } ]
                },
                runnerErrors: []
            };
        }
    );
    const lifecycle = await acquireWorkerPoolResourceLifecycle(runtime, placementPlan(runtime));

    scope.assert.equal(lifecycle.runResourceOwner, true);
    scope.assert.deepEqual(lifecycle.projectedResources, {
        resources: [ { boundaryKey: 'run:database', payload: 'database-handle' } ]
    });
}

async function assertInvalidRunResourceOutputIsRejected(scope: OverkillScope): Promise<void> {
    const runtime = runtimeWithPoolRun(
        collectedPlanWithResources([ resource('database', 'per-run') ]),
        async function runInvalidResourceTask() {
            return { invalid: true };
        }
    );

    await scope.assert.rejects(async function acquireInvalidRunResources() {
        await acquireWorkerPoolResourceLifecycle(runtime, placementPlan(runtime));
    }, { message: 'Worker-pool run resource task returned an invalid result.' });
}

async function assertLaneResourceDisposalRunsOnEachLane(scope: OverkillScope): Promise<void> {
    const disposedLanes: string[] = [];
    const runtime = runtimeWithPoolRun(
        collectedPlanWithResources([ resource('scratch', 'per-case') ]),
        async function runDisposeTask(task) {
            scope.assert.equal(readTaskKind(task), 'dispose-lane-lifecycle');
            disposedLanes.push(readTaskLane(task));

            return { runnerErrors: [] };
        }
    );
    const lifecycle = await acquireWorkerPoolResourceLifecycle(runtime, placementPlan(runtime));

    await disposeWorkerPoolResourceLifecycles(runtime, placementPlan(runtime), lifecycle);

    scope.assert.deepEqual(disposedLanes, [ 'worker-1' ]);
}

async function assertRunResourceDisposalFailureRecordsRunnerError(scope: OverkillScope): Promise<void> {
    const runtime = runtimeWithPoolRun(
        collectedPlanWithResources([ resource('database', 'per-run') ]),
        async function runResourceTask(task) {
            if (readTaskKind(task) === 'acquire-run-resources') {
                return { projectedResources: { resources: [] }, runnerErrors: [] };
            }

            throw new Error('dispose failed');
        }
    );
    const lifecycle = await acquireWorkerPoolResourceLifecycle(runtime, placementPlan(runtime));

    await disposeWorkerPoolResourceLifecycles(runtime, placementPlan(runtime), lifecycle);

    scope.assert.equal(
        runtime.runState.runnerErrors()[0]?.message,
        'Worker-pool run resource disposal failed.'
    );
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-resource-lifecycle-execution.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool per-run resources acquire through the owner lane',
            async body(scope: OverkillScope) {
                await assertPerRunResourcesUseOwner(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool per-run resource acquisition rejects invalid worker output',
            async body(scope: OverkillScope) {
                await assertInvalidRunResourceOutputIsRejected(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool lane resources dispose each lane lifecycle',
            async body(scope: OverkillScope) {
                await assertLaneResourceDisposalRunsOnEachLane(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool run resource disposal records runner errors',
            async body(scope: OverkillScope) {
                await assertRunResourceDisposalFailureRecordsRunnerError(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

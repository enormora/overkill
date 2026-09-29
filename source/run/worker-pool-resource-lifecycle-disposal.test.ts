import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type RunnerError,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { ResourceScope } from '../resources/resources.ts';
import { createResourceOwnershipPlan } from './execution-plan-resolution.ts';
import {
    acquireWorkerPoolResourceLifecycle,
    collectedPlanNeedsLaneResourceLifecycle,
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
        handleTransport: 'local',
        name,
        requirements: [],
        scenarios: [],
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
                            directResources: resourceGraph.map(function directResource(resourceValue) {
                                return { key: resourceValue.name, resourceName: resourceValue.name };
                            }),
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

    return {
        ...plan,
        resourceOwnership: createResourceOwnershipPlan({
            lanes: plan.lanes,
            selectedPlan: runtime.collectedPlan,
            units: plan.units
        })
    };
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

function runnerError(message: string): RunnerError {
    return {
        attributedTo: null,
        attributedToWork: null,
        cause: null,
        diagnostics: [],
        message,
        subtype: 'runtime-policy'
    };
}

async function assertNoResourcesSkipWorkerTasks(scope: OverkillScope): Promise<void> {
    const runtime = runtimeWithPoolRun(collectedPlanWithResources([]), async function rejectUnexpectedTask() {
        throw new Error('Worker resource task should not run.');
    });
    const lifecycle = await acquireWorkerPoolResourceLifecycle(runtime, placementPlan(runtime));

    runtime.terminalFailure.write(true);
    await disposeWorkerPoolResourceLifecycles(runtime, placementPlan(runtime), lifecycle);

    scope.assert.equal(lifecycle.resourceOwner, false);
    scope.assert.deepEqual(lifecycle.projectedResources, { resources: [] });
    scope.assert.equal(collectedPlanNeedsLaneResourceLifecycle(runtime), false);
}

async function assertInvalidLaneDisposalRecordsRunnerError(scope: OverkillScope): Promise<void> {
    const runtime = runtimeWithPoolRun(
        collectedPlanWithResources([ resource('scratch', 'per-case') ]),
        async function runInvalidDisposalTask() {
            return { invalid: true };
        }
    );
    const lifecycle = await acquireWorkerPoolResourceLifecycle(runtime, placementPlan(runtime));

    await disposeWorkerPoolResourceLifecycles(runtime, placementPlan(runtime), lifecycle);

    scope.assert.equal(collectedPlanNeedsLaneResourceLifecycle(runtime), true);
    scope.assert.equal(
        runtime.runState.runnerErrors()[0]?.message,
        'Worker-pool lane resource disposal failed.'
    );
}

async function assertRunResourceErrorsStopTheRun(scope: OverkillScope): Promise<void> {
    const runtime = runtimeWithPoolRun(
        collectedPlanWithResources([ resource('database', 'per-run') ]),
        async function runResourceTask() {
            return {
                projectedResources: { resources: [] },
                runnerErrors: [ runnerError('database failed') ]
            };
        }
    );

    await acquireWorkerPoolResourceLifecycle(runtime, placementPlan(runtime));

    scope.assert.equal(runtime.terminalFailure.read(), true);
    scope.assert.equal(runtime.runState.runnerErrors()[0]?.message, 'database failed');
}

async function assertTerminalFailureSuppressesDisposalFailures(scope: OverkillScope): Promise<void> {
    const runtime = runtimeWithPoolRun(collectedPlanWithResources([]), async function runFailingDisposalTask() {
        throw new Error('dispose failed');
    });

    runtime.terminalFailure.write(true);
    await disposeWorkerPoolResourceLifecycles(runtime, placementPlan(runtime), {
        completedWork: new Set(),
        ownerBoundaryKeysByWork: new Map(),
        ownerLane: 'run-resource-owner',
        projectionBoundaryKeysByWork: new Map(),
        projectedResources: { resources: [] },
        resourceOwner: true,
        runWork: []
    });

    scope.assert.deepEqual(runtime.runState.runnerErrors(), []);
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-resource-lifecycle-disposal.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool resource lifecycle skips worker tasks without resources',
            async body(scope: OverkillScope) {
                await assertNoResourcesSkipWorkerTasks(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool resource lifecycle records invalid lane disposal output',
            async body(scope: OverkillScope) {
                await assertInvalidLaneDisposalRecordsRunnerError(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool resource lifecycle records run resource runner errors',
            async body(scope: OverkillScope) {
                await assertRunResourceErrorsStopTheRun(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool resource lifecycle suppresses disposal failures after terminal failure',
            async body(scope: OverkillScope) {
                await assertTerminalFailureSuppressesDisposalFailures(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

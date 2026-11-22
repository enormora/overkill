import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

import type { RunnerError } from '../packages/engine/engine.entry-point.ts';
import type { ResourceScope } from '../resources/resources.ts';
import { createCollectedPlan, fakeWorkerRuntime } from '../test-support/worker-pool-execution-state.ts';
import { createResourceOwnershipPlan } from './execution-plan-resolution.ts';
import {
    acquireWorkerPoolResourceLifecycle,
    collectedPlanNeedsLaneResourceLifecycle,
    disposeWorkerPoolResourceLifecycles
} from './worker-pool-resource-lifecycle-execution.ts';
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
        workload: 'independent' as const,
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
        attributedToAttempt: null,
        attributedTo: null,
        attributedToWork: null,
        cause: null,
        diagnostics: [],
        message,
        subtype: 'runtime-policy'
    };
}

const assertNoResourcesSkipWorkerTasks = defineCompositeAssertion({
    name: 'no resources skip worker tasks',
    async assert(check) {
        const runtime = runtimeWithPoolRun(collectedPlanWithResources([]), async function rejectUnexpectedTask() {
            throw new Error('Worker resource task should not run.');
        });
        const lifecycle = await acquireWorkerPoolResourceLifecycle(runtime, placementPlan(runtime));
        runtime.terminalFailure.write(true);
        await disposeWorkerPoolResourceLifecycles(runtime, placementPlan(runtime), lifecycle);
        return check.group([
            check.equal(lifecycle.resourceOwner, false),
            check.deepEqual(lifecycle.projectedResources, { resources: [] }),
            check.equal(collectedPlanNeedsLaneResourceLifecycle(runtime), false)
        ]);
    }
});

const assertInvalidLaneDisposalRecordsRunnerError = defineCompositeAssertion({
    name: 'invalid lane disposal records runner error',
    async assert(check) {
        const runtime = runtimeWithPoolRun(
            collectedPlanWithResources([ resource('scratch', 'per-case') ]),
            async function runInvalidDisposalTask() {
                return { invalid: true };
            }
        );
        const lifecycle = await acquireWorkerPoolResourceLifecycle(runtime, placementPlan(runtime));
        await disposeWorkerPoolResourceLifecycles(runtime, placementPlan(runtime), lifecycle);
        return check.group([
            check.equal(collectedPlanNeedsLaneResourceLifecycle(runtime), true),
            check.equal(
                runtime.runState.runnerErrors()[0]?.message,
                'Worker-pool lane resource disposal failed.'
            )
        ]);
    }
});

const assertRunResourceErrorsStopTheRun = defineCompositeAssertion({
    name: 'run resource errors stop the run',
    async assert(check) {
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
        return check.group([
            check.equal(runtime.terminalFailure.read(), true),
            check.equal(runtime.runState.runnerErrors()[0]?.message, 'database failed')
        ]);
    }
});

const assertTerminalFailureSuppressesDisposalFailures = defineCompositeAssertion({
    name: 'terminal failure suppresses disposal failures',
    async assert(check) {
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
        return check.group([ check.deepEqual(runtime.runState.runnerErrors(), []) ]);
    }
});

export const testNode = suite({
    ...testCaseMetadata,
    title: 'Worker pool resource lifecycle disposal',
    children: [
        test({
            ...testCaseMetadata,
            title: 'skips worker tasks without resources',
            async body(scope) {
                await scope.assert(assertNoResourcesSkipWorkerTasks);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'records invalid lane disposal output',
            async body(scope) {
                await scope.assert(assertInvalidLaneDisposalRecordsRunnerError);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'records run resource runner errors',
            async body(scope) {
                await scope.assert(assertRunResourceErrorsStopTheRun);

                return scope.assert.collect();
            }
        }),
        test({
            ...testCaseMetadata,
            title: 'suppresses disposal failures after terminal failure',
            async body(scope) {
                await scope.assert(assertTerminalFailureSuppressesDisposalFailures);

                return scope.assert.collect();
            }
        })
    ]
});

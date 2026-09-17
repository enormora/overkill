import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createSupervisedRunState } from './supervised-run-state.ts';
import { createWorkerPoolRuntime, type WorkerPoolRunRuntime } from './worker-pool-runtime.ts';
import {
    createCollectedPlan,
    fakeDependencies,
    workerPoolResolvedRun
} from './worker-pool-runtime.test.ts';

type ResolvedRun = WorkerPoolRunRuntime['resolvedRun'];
type PlacementPlan = NonNullable<ResolvedRun['facts']['execution']['placementPlan']>;

function placementPlan(resolvedRun: ResolvedRun): PlacementPlan {
    const plan = resolvedRun.facts.execution.placementPlan;

    if (plan === null) {
        throw new Error('Worker-pool runtime edge test requires a placement plan.');
    }

    return plan;
}

function resolvedRunWithPlacementPlan(placement: PlacementPlan): ResolvedRun {
    const resolvedRun = workerPoolResolvedRun(createCollectedPlan());

    return {
        ...resolvedRun,
        facts: {
            ...resolvedRun.facts,
            execution: {
                ...resolvedRun.facts.execution,
                placementPlan: placement
            }
        }
    };
}

async function createRuntime(resolvedRun: ResolvedRun): Promise<void> {
    await createWorkerPoolRuntime({
        collectionRunnerErrors: [],
        createdPool: null,
        dependencies: fakeDependencies(),
        resolvedRun,
        runState: createSupervisedRunState()
    });
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-runtime-edge.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool runtime rejects invalid placement plans',
            async body(scope: OverkillScope) {
                const resolvedRun = workerPoolResolvedRun(createCollectedPlan());
                const plan = placementPlan(resolvedRun);
                const [ unit ] = plan.units;
                const [ assignment ] = plan.assignments;

                if (unit === undefined || assignment === undefined) {
                    throw new Error('Worker-pool runtime edge test requires planned work.');
                }

                await scope.assert.rejects(async function createRuntimeWithUnknownAssignment() {
                    await createRuntime(resolvedRunWithPlacementPlan({
                        ...plan,
                        assignments: [
                            {
                                lane: assignment.lane,
                                unit: { key: 'missing', mode: 'file', runtime: null, workload: null }
                            }
                        ]
                    }));
                }, { message: 'Placement assignment referenced an unknown work unit.' });
                await scope.assert.rejects(async function createRuntimeWithMixedLaneLifecycle() {
                    await createRuntime(resolvedRunWithPlacementPlan({
                        ...plan,
                        assignments: [
                            { lane: 'shared', unit: unit.id },
                            {
                                lane: 'shared',
                                unit: { key: 'fresh', mode: 'file', runtime: null, workload: null }
                            }
                        ],
                        units: [
                            unit,
                            {
                                ...unit,
                                id: { key: 'fresh', mode: 'file', runtime: null, workload: null },
                                workerLifecycle: 'fresh-worker-per-unit'
                            }
                        ]
                    }));
                }, { message: 'Placement lane cannot mix worker lifecycle policies.' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type {
    PlacementPlan,
    WorkUnit
} from './run-types.ts';
import {
    createBatchRunCommand,
    createRunCommand,
    firstPlanUnit,
    placementRunWork
} from './worker-pool-command.ts';
import type { WorkerPoolLeaseMember } from './worker-pool-dispatch-state.ts';
import {
    createCollectedPlan,
    fakeWorkerRuntime
} from './worker-pool-execution-state.test.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';

const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
} as const;

function placementPlan(runtime: WorkerPoolRunRuntime): PlacementPlan {
    const plan = runtime.resolvedRun.facts.execution.placementPlan;

    if (plan === null) {
        throw new Error('Worker-pool runtime fixture requires a placement plan.');
    }

    return plan;
}

function firstUnit(runtime: WorkerPoolRunRuntime): WorkUnit {
    return firstPlanUnit(placementPlan(runtime));
}

function childHostRuntime(runtime: WorkerPoolRunRuntime): WorkerPoolRunRuntime {
    const { execution } = runtime.resolvedRun.facts;

    if (execution.processModel !== 'worker-pool') {
        throw new Error('Worker-pool command fixture requires worker-pool execution facts.');
    }

    return {
        ...runtime,
        resolvedRun: {
            ...runtime.resolvedRun,
            facts: {
                ...runtime.resolvedRun.facts,
                execution: {
                    ...execution,
                    hostProcess: {
                        kind: 'child',
                        nodeArguments: [ '--conditions=fixture' ],
                        reasons: [ 'node-arguments' ]
                    }
                }
            }
        }
    };
}

function unitWithoutFile(runtime: WorkerPoolRunRuntime): WorkUnit {
    const unit = firstUnit(runtime);
    const work = unit.work[0];

    return {
        ...unit,
        work: [
            {
                ...work,
                case: {
                    ...work.case,
                    file: null
                }
            }
        ]
    };
}

function leaseMember(unit: WorkUnit): WorkerPoolLeaseMember {
    return {
        attempt: 'attempt-1',
        traceUnit: {
            key: unit.id.key,
            mode: unit.id.mode,
            runtimes: unit.id.runtimes,
            workload: unit.id.workload
        },
        unit
    };
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/worker-pool-command.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool command helpers read placement work',
            body(scope: OverkillScope) {
                const runtime = fakeWorkerRuntime(createCollectedPlan());
                const plan = placementPlan(runtime);

                scope.assert.equal(firstPlanUnit(plan), plan.units[0]);
                scope.assert.deepEqual(
                    placementRunWork(plan),
                    plan.units.flatMap(function toWork(unit) {
                        return unit.work;
                    })
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool command helpers build child host batch commands',
            body(scope: OverkillScope) {
                const runtime = childHostRuntime(fakeWorkerRuntime(createCollectedPlan()));
                const unit = firstUnit(runtime);
                const command = createBatchRunCommand(runtime, [ leaseMember(unit) ]);

                scope.assert.deepEqual(command.hostProcess, {
                    kind: 'child',
                    nodeArguments: [ '--conditions=fixture' ]
                });
                scope.assert.deepEqual(command.paths, [ 'source/integration-tests/run/fixtures/passing.test.ts' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'worker-pool command helpers reject invalid placement inputs',
            body(scope: OverkillScope) {
                const runtime = fakeWorkerRuntime(createCollectedPlan());

                scope.assert.throws(function readEmptyPlan() {
                    firstPlanUnit({ assignments: [], lanes: [], resourceOwnership: { owners: [] }, units: [] });
                }, {
                    message: 'Worker-pool resource acquisition requires a work unit.'
                });
                scope.assert.throws(function createCommandForVirtualCase() {
                    createRunCommand(runtime, unitWithoutFile(runtime));
                }, {
                    message: 'Worker-pool work units require file-backed cases.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

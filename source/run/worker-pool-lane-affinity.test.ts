import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    emptyWorkUnitResourceConstraints,
    type RunWorkerLifecycle,
    type WorkUnit,
    type WorkUnitResourceConstraints
} from './run-types.ts';
import {
    workerPoolLanes,
    workerPoolPlacementAssignments
} from './worker-pool-lanes.ts';

function workUnitWithConstraints(
    key: string,
    workerLifecycle: RunWorkerLifecycle,
    resourceConstraints: WorkUnitResourceConstraints
): WorkUnit {
    return {
        group: null,
        id: { key, mode: 'file', runtimes: [], workload: null },
        order: 'plan',
        resourceConstraints,
        scheduling: 'concurrent',
        work: [
            {
                case: { file: key, params: null, suite: [], title: key },
                runtimes: [],
                workload: null
            }
        ],
        workerLifecycle
    };
}

function assignedLanes(units: readonly WorkUnit[], availableParallelism: number): readonly string[] {
    const lanes = workerPoolLanes({ assignmentPolicy: 'stable', availableParallelism, units });

    return workerPoolPlacementAssignments(units, lanes, 'stable').map(function toLane(assignment) {
        return assignment.lane;
    });
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-lane-affinity.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool lane affinity breaks ties after load',
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    assignedLanes([
                        workUnitWithConstraints('affinity-tie-1', 'reuse', {
                            ...emptyWorkUnitResourceConstraints,
                            affinityKeys: [ 'tenant:a' ]
                        }),
                        workUnitWithConstraints('affinity-tie-filler', 'reuse', emptyWorkUnitResourceConstraints),
                        workUnitWithConstraints('affinity-tie-2', 'reuse', {
                            ...emptyWorkUnitResourceConstraints,
                            affinityKeys: [ 'tenant:a' ]
                        })
                    ], 3),
                    [
                        'worker-1',
                        'worker-2',
                        'worker-1'
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool lane affinity loses to fault-domain spreading',
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    assignedLanes([
                        workUnitWithConstraints('affinity-fault-1', 'reuse', {
                            ...emptyWorkUnitResourceConstraints,
                            affinityKeys: [ 'tenant:a' ],
                            faultDomains: [ 'postgres:primary' ]
                        }),
                        workUnitWithConstraints('affinity-fault-2', 'reuse', {
                            ...emptyWorkUnitResourceConstraints,
                            affinityKeys: [ 'tenant:a' ],
                            faultDomains: [ 'postgres:primary' ]
                        })
                    ], 3),
                    [
                        'worker-1',
                        'worker-2'
                    ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

import { type TestNode, suite, test } from '@overkill-dev/test';

import type { WorkerLifecycle } from '../config/types.ts';
import { emptyWorkUnitResourceConstraints, type WorkUnit, type WorkUnitResourceConstraints } from './run-types.ts';
import { workerPoolLanes, workerPoolPlacementAssignments } from './worker-pool-lanes.ts';

function workUnitWithConstraints(
    key: string,
    workerLifecycle: WorkerLifecycle,
    resourceConstraints: WorkUnitResourceConstraints
): WorkUnit {
    return {
        group: null,
        id: { familyVariant: null, key, mode: 'file', runtimes: [], workload: null },
        order: 'plan',
        resourceConstraints,
        scheduling: 'concurrent',
        work: [
            {
                familyVariant: null,
                case: { file: key, params: null, suite: [], title: key },
                runtimes: [],
                workload: null
            }
        ],
        workerLifecycle
    };
}

function assignedLanes(units: readonly WorkUnit[], availableParallelism: number): readonly string[] {
    const lanes = workerPoolLanes({
        assignmentPolicy: 'stable',
        availableParallelism,
        maximumWorkers: null,
        profileMaximum: null,
        requestedWorkers: null,
        units
    });

    return workerPoolPlacementAssignments(units, lanes, 'stable').map(function toLane(assignment) {
        return assignment.lane;
    });
}

export const testNode: TestNode = suite('Worker pool lane affinity', [
    test('breaks ties after load', function (scope) {
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
    }),
    test('loses to fault-domain spreading', function (scope) {
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
    })
]);

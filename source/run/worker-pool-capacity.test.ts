import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    emptyWorkUnitResourceConstraints,
    type RunWorkerLifecycle,
    type WorkUnit
} from './run-types.ts';
import {
    resolveWorkerCount,
    workerPoolLanes,
    workerPoolPlacementAssignments
} from './worker-pool-lanes.ts';

function weightedWorkUnit(key: string, workerLifecycle: RunWorkerLifecycle, capacityWeight: number): WorkUnit {
    return {
        group: null,
        id: { key, mode: 'file', runtimes: [], workload: null },
        order: 'plan',
        resourceConstraints: { ...emptyWorkUnitResourceConstraints, capacityWeight },
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

function workUnit(key: string, workerLifecycle: RunWorkerLifecycle): WorkUnit {
    return weightedWorkUnit(key, workerLifecycle, emptyWorkUnitResourceConstraints.capacityWeight);
}

function workerCount(
    units: readonly WorkUnit[],
    host: number,
    profile: number | null,
    requested: number | null
): number {
    return resolveWorkerCount({
        assignmentPolicy: 'stable',
        availableParallelism: host,
        profileMaximum: profile,
        requestedWorkers: requested,
        units
    })
        .resolved;
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-capacity.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker count resolves defaults and caps in precedence order',
            body(scope: OverkillScope) {
                const units = Array.from({ length: 16 }, function toUnit(_value, index) {
                    return workUnit(`reuse-${index + 1}`, 'reuse');
                });

                scope.assert.equal(workerCount(units, 16, null, null), 8);
                scope.assert.equal(workerCount(units, 4, null, 8), 4);
                scope.assert.equal(workerCount(units, 16, 3, 6), 3);
                scope.assert.equal(workerCount(units.slice(0, 2), 16, null, 6), 2);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker count records its resolution inputs',
            body(scope: OverkillScope) {
                const units = [ workUnit('reuse-1', 'reuse'), workUnit('reuse-2', 'reuse') ];

                scope.assert.deepEqual(
                    resolveWorkerCount({
                        assignmentPolicy: 'stable',
                        availableParallelism: 6,
                        profileMaximum: 4,
                        requestedWorkers: 3,
                        units
                    }),
                    {
                        hostMaximum: 6,
                        profileMaximum: 4,
                        requested: 3,
                        resolved: 2
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker count rejects mixed lifecycles without enough workers',
            body(scope: OverkillScope) {
                scope.assert.throws(function resolveOneWorkerForMixedLifecycles() {
                    workerCount(
                        [
                            workUnit('reuse', 'reuse'),
                            workUnit('fresh', 'fresh-worker-per-unit')
                        ],
                        8,
                        null,
                        1
                    );
                }, { message: 'Worker-pool execution requires at least 2 workers for its worker lifecycles.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool lanes use capacity weight for mixed lifecycle allocation',
            body(scope: OverkillScope) {
                const units = [
                    workUnit('fresh-1', 'fresh-worker-per-unit'),
                    workUnit('fresh-2', 'fresh-worker-per-unit'),
                    workUnit('fresh-3', 'fresh-worker-per-unit'),
                    weightedWorkUnit('reuse-heavy', 'reuse', 10),
                    workUnit('reuse-2', 'reuse'),
                    workUnit('reuse-3', 'reuse')
                ];
                const lanes = workerPoolLanes({
                    assignmentPolicy: 'stable',
                    availableParallelism: 5,
                    profileMaximum: null,
                    requestedWorkers: null,
                    units
                });
                const assignments = workerPoolPlacementAssignments(units, lanes, 'stable');

                scope.assert.deepEqual(
                    assignments.map(function toLane(assignment) {
                        return assignment.lane;
                    }),
                    [ 'worker-4', 'worker-4', 'worker-4', 'worker-1', 'worker-2', 'worker-3' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

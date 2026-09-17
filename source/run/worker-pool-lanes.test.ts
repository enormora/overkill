import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    emptyWorkUnitResourceConstraints,
    type PlacementLane,
    type RunWorkerPoolAssignmentPolicy,
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
    caseCount: number,
    resourceConstraints: WorkUnitResourceConstraints
): WorkUnit {
    return {
        group: null,
        id: { key, mode: 'file', runtime: null, workload: null },
        order: 'plan',
        resourceConstraints,
        scheduling: 'concurrent',
        work: [
            {
                case: { file: key, params: null, suite: [], title: key },
                runtime: null,
                workload: null
            },
            ...Array.from({ length: caseCount - 1 }, function toWork(_value, index) {
                return {
                    case: { file: key, params: null, suite: [], title: `${key}-${index + 2}` },
                    runtime: null,
                    workload: null
                };
            })
        ],
        workerLifecycle
    };
}

function workUnitWithCases(key: string, workerLifecycle: RunWorkerLifecycle, caseCount: number): WorkUnit {
    return workUnitWithConstraints(key, workerLifecycle, caseCount, emptyWorkUnitResourceConstraints);
}

function workUnit(key: string, workerLifecycle: RunWorkerLifecycle): WorkUnit {
    return workUnitWithCases(key, workerLifecycle, 1);
}

function placementLane(id: string): PlacementLane {
    return {
        executor: {
            capabilities: [],
            capacity: 1,
            id,
            kind: 'local-worker'
        },
        id
    };
}

function assignedLanes(
    units: readonly WorkUnit[],
    availableParallelism: number,
    assignmentPolicy: RunWorkerPoolAssignmentPolicy = 'stable'
): readonly string[] {
    const lanes = workerPoolLanes({ assignmentPolicy, availableParallelism, units });

    return workerPoolPlacementAssignments(units, lanes, assignmentPolicy).map(function toLane(assignment) {
        return assignment.lane;
    });
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-lanes.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool lanes partition mixed worker lifecycles',
            body(scope: OverkillScope) {
                const units = [
                    workUnit('reuse-1', 'reuse'),
                    workUnit('reuse-2', 'reuse'),
                    workUnit('reuse-3', 'reuse'),
                    workUnit('fresh-1', 'fresh-worker-per-unit'),
                    workUnit('fresh-2', 'fresh-worker-per-unit')
                ];
                const lanes = workerPoolLanes({ assignmentPolicy: 'stable', availableParallelism: 5, units });

                scope.assert.equal(lanes.length, 4);
                scope.assert.deepEqual(assignedLanes(units, 5), [
                    'worker-1',
                    'worker-2',
                    'worker-1',
                    'worker-3',
                    'worker-4'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool lanes keep fresh-only units on fresh lanes',
            body(scope: OverkillScope) {
                const units = [
                    workUnit('fresh-1', 'fresh-worker-per-unit'),
                    workUnit('fresh-2', 'fresh-worker-per-unit'),
                    workUnit('fresh-3', 'fresh-worker-per-unit')
                ];

                scope.assert.deepEqual(assignedLanes(units, 4), [
                    'worker-1',
                    'worker-2',
                    'worker-3'
                ]);
                scope.assert.throws(function assignWithoutLanes() {
                    workerPoolPlacementAssignments([ workUnit('missing-lane', 'reuse') ], [], 'stable');
                }, { message: 'Worker-pool placement requires at least one lane.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool lanes keep reuse-only units on reusable lanes',
            body(scope: OverkillScope) {
                const units = [
                    workUnit('reuse-1', 'reuse'),
                    workUnit('reuse-2', 'reuse'),
                    workUnit('reuse-3', 'reuse')
                ];

                scope.assert.deepEqual(assignedLanes(units, 4), [
                    'worker-1',
                    'worker-2',
                    'worker-3'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool lanes give tied extra capacity to the first lifecycle',
            body(scope: OverkillScope) {
                const units = [
                    workUnit('fresh-1', 'fresh-worker-per-unit'),
                    workUnit('reuse-1', 'reuse'),
                    workUnit('fresh-2', 'fresh-worker-per-unit'),
                    workUnit('reuse-2', 'reuse')
                ];

                scope.assert.deepEqual(assignedLanes(units, 4), [
                    'worker-2',
                    'worker-1',
                    'worker-3',
                    'worker-1'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool lanes reject units with unknown lifecycles',
            body(scope: OverkillScope) {
                const unit = {
                    ...workUnit('unknown-1', 'reuse'),
                    workerLifecycle: 'unknown' as RunWorkerLifecycle
                };
                const lanes = workerPoolLanes({
                    assignmentPolicy: 'stable',
                    availableParallelism: 2,
                    units: [ unit ]
                });

                scope.assert.throws(function assignUnknownLifecycle() {
                    workerPoolPlacementAssignments([ unit ], lanes, 'stable');
                }, { message: 'Worker-pool placement requires at least one lane.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool lanes assign extra mixed capacity proportionally to reuse units',
            body(scope: OverkillScope) {
                const units = [
                    workUnit('fresh-1', 'fresh-worker-per-unit'),
                    workUnit('fresh-2', 'fresh-worker-per-unit'),
                    workUnit('fresh-3', 'fresh-worker-per-unit'),
                    workUnit('reuse-1', 'reuse'),
                    workUnit('reuse-2', 'reuse')
                ];

                scope.assert.deepEqual(assignedLanes(units, 5), [
                    'worker-3',
                    'worker-4',
                    'worker-3',
                    'worker-1',
                    'worker-2'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool lanes apply resource placement constraints',
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    assignedLanes([
                        workUnitWithConstraints('serial-1', 'reuse', 1, {
                            ...emptyWorkUnitResourceConstraints,
                            serialKeys: [ 'database' ]
                        }),
                        workUnitWithConstraints('serial-2', 'reuse', 1, {
                            ...emptyWorkUnitResourceConstraints,
                            serialKeys: [ 'database' ]
                        })
                    ], 3),
                    [
                        'worker-1',
                        'worker-1'
                    ]
                );
                scope.assert.deepEqual(
                    assignedLanes([
                        workUnitWithConstraints('single-worker-1', 'reuse', 1, {
                            ...emptyWorkUnitResourceConstraints,
                            singleWorkerKeys: [ 'file:source/api.test.ts' ]
                        }),
                        workUnitWithConstraints('single-worker-2', 'reuse', 1, {
                            ...emptyWorkUnitResourceConstraints,
                            singleWorkerKeys: [ 'file:source/api.test.ts' ]
                        })
                    ], 3),
                    [
                        'worker-1',
                        'worker-1'
                    ]
                );
                scope.assert.deepEqual(
                    assignedLanes([
                        workUnitWithConstraints('affinity-1', 'reuse', 1, {
                            ...emptyWorkUnitResourceConstraints,
                            affinityKeys: [ 'tenant:a' ]
                        }),
                        workUnitWithConstraints('affinity-2', 'reuse', 1, {
                            ...emptyWorkUnitResourceConstraints,
                            affinityKeys: [ 'tenant:a' ]
                        })
                    ], 3),
                    [
                        'worker-1',
                        'worker-1'
                    ]
                );
                scope.assert.deepEqual(
                    assignedLanes([
                        workUnitWithConstraints('fault-domain-1', 'reuse', 1, {
                            ...emptyWorkUnitResourceConstraints,
                            faultDomains: [ 'postgres:primary' ]
                        }),
                        workUnitWithConstraints('fault-domain-2', 'reuse', 1, {
                            ...emptyWorkUnitResourceConstraints,
                            faultDomains: [ 'postgres:primary' ]
                        }),
                        workUnitWithConstraints('fault-domain-3', 'reuse', 1, {
                            ...emptyWorkUnitResourceConstraints,
                            faultDomains: [ 'postgres:primary' ]
                        })
                    ], 4),
                    [
                        'worker-1',
                        'worker-2',
                        'worker-3'
                    ]
                );
                scope.assert.deepEqual(
                    assignedLanes([
                        workUnitWithConstraints('capacity-1', 'reuse', 1, {
                            ...emptyWorkUnitResourceConstraints,
                            capacityWeight: 4
                        }),
                        workUnitWithConstraints('capacity-2', 'reuse', 1, {
                            ...emptyWorkUnitResourceConstraints,
                            capacityWeight: 2
                        }),
                        workUnitWithConstraints('capacity-3', 'reuse', 1, {
                            ...emptyWorkUnitResourceConstraints,
                            capacityWeight: 2
                        })
                    ], 3),
                    [
                        'worker-1',
                        'worker-2',
                        'worker-2'
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool lanes balance mixed lifecycle ties deterministically',
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    assignedLanes(
                        [
                            workUnitWithCases('fresh-a', 'fresh-worker-per-unit', 1),
                            workUnitWithCases('fresh-b', 'fresh-worker-per-unit', 1),
                            workUnitWithCases('reuse-a', 'reuse', 1),
                            workUnitWithCases('reuse-b', 'reuse', 1)
                        ],
                        4,
                        'case-count-balanced'
                    ),
                    [
                        'worker-2',
                        'worker-3',
                        'worker-1',
                        'worker-1'
                    ]
                );
                scope.assert.deepEqual(
                    assignedLanes(
                        [
                            workUnitWithCases('reuse-a', 'reuse', 1),
                            workUnitWithCases('reuse-b', 'reuse', 1),
                            workUnitWithCases('fresh-a', 'fresh-worker-per-unit', 1),
                            workUnitWithCases('fresh-b', 'fresh-worker-per-unit', 1)
                        ],
                        4,
                        'case-count-balanced'
                    ),
                    [
                        'worker-1',
                        'worker-2',
                        'worker-3',
                        'worker-3'
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool lanes stop mixed lifecycle allocation at unit capacity',
            body(scope: OverkillScope) {
                const freshUnit = workUnitWithCases('fresh', 'fresh-worker-per-unit', 1);
                const reuseUnit = workUnitWithCases('reuse', 'reuse', 1);
                const units = [ freshUnit, reuseUnit ];

                scope.assert.deepEqual(
                    workerPoolPlacementAssignments(
                        units,
                        [
                            placementLane('worker-1'),
                            placementLane('worker-2'),
                            placementLane('worker-3')
                        ],
                        'case-count-balanced'
                    ),
                    [
                        { lane: 'worker-2', unit: freshUnit.id },
                        { lane: 'worker-1', unit: reuseUnit.id }
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool lanes balance selected case counts',
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    assignedLanes(
                        [
                            workUnitWithCases('large', 'reuse', 3),
                            workUnitWithCases('small-a', 'reuse', 1),
                            workUnitWithCases('small-b', 'reuse', 1)
                        ],
                        3,
                        'case-count-balanced'
                    ),
                    [
                        'worker-1',
                        'worker-2',
                        'worker-2'
                    ]
                );
                scope.assert.deepEqual(
                    assignedLanes(
                        [
                            workUnitWithCases('large', 'reuse', 3),
                            workUnitWithCases('small-a', 'reuse', 1),
                            workUnitWithCases('small-b', 'reuse', 1)
                        ],
                        3,
                        'stable'
                    ),
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
            title: 'worker-pool lanes redistribute capped mixed lifecycle capacity',
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    assignedLanes(
                        [
                            workUnitWithCases('fresh-large', 'fresh-worker-per-unit', 6),
                            workUnitWithCases('reuse-a', 'reuse', 1),
                            workUnitWithCases('reuse-b', 'reuse', 1),
                            workUnitWithCases('reuse-c', 'reuse', 1)
                        ],
                        5,
                        'case-count-balanced'
                    ),
                    [
                        'worker-4',
                        'worker-1',
                        'worker-2',
                        'worker-3'
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool lanes reject invalid available parallelism',
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    workerPoolLanes({
                        assignmentPolicy: 'stable',
                        availableParallelism: 1,
                        units: []
                    }),
                    []
                );
                scope.assert.throws(function createLaneWithoutPositiveParallelism() {
                    workerPoolLanes({
                        assignmentPolicy: 'stable',
                        availableParallelism: 0,
                        units: [ workUnit('reuse-1', 'reuse') ]
                    });
                }, { message: 'Available parallelism must be a positive safe integer.' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

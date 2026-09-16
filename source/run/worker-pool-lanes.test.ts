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
        id: { key, mode: 'file', runtime: null, workload: null },
        order: 'plan',
        resourceConstraints,
        scheduling: 'concurrent',
        work: [
            {
                case: { file: key, params: null, suite: [], title: key },
                runtime: null,
                workload: null
            }
        ],
        workerLifecycle
    };
}

function workUnit(key: string, workerLifecycle: RunWorkerLifecycle): WorkUnit {
    return workUnitWithConstraints(key, workerLifecycle, emptyWorkUnitResourceConstraints);
}

function assignedLanes(units: readonly WorkUnit[], availableParallelism: number): readonly string[] {
    const lanes = workerPoolLanes({ availableParallelism, units });

    return workerPoolPlacementAssignments(units, lanes).map(function toLane(assignment) {
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
                const lanes = workerPoolLanes({ availableParallelism: 5, units });

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
                    workerPoolPlacementAssignments([ workUnit('missing-lane', 'reuse') ], []);
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
                    availableParallelism: 2,
                    units: [ unit ]
                });

                scope.assert.throws(function assignUnknownLifecycle() {
                    workerPoolPlacementAssignments([ unit ], lanes);
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
                        workUnitWithConstraints('serial-1', 'reuse', {
                            ...emptyWorkUnitResourceConstraints,
                            serialKeys: [ 'database' ]
                        }),
                        workUnitWithConstraints('serial-2', 'reuse', {
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
                        workUnitWithConstraints('single-worker-1', 'reuse', {
                            ...emptyWorkUnitResourceConstraints,
                            singleWorkerKeys: [ 'file:source/api.test.ts' ]
                        }),
                        workUnitWithConstraints('single-worker-2', 'reuse', {
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
                        workUnitWithConstraints('affinity-1', 'reuse', {
                            ...emptyWorkUnitResourceConstraints,
                            affinityKeys: [ 'tenant:a' ]
                        }),
                        workUnitWithConstraints('affinity-2', 'reuse', {
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
                        workUnitWithConstraints('fault-domain-1', 'reuse', {
                            ...emptyWorkUnitResourceConstraints,
                            faultDomains: [ 'postgres:primary' ]
                        }),
                        workUnitWithConstraints('fault-domain-2', 'reuse', {
                            ...emptyWorkUnitResourceConstraints,
                            faultDomains: [ 'postgres:primary' ]
                        }),
                        workUnitWithConstraints('fault-domain-3', 'reuse', {
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
                        workUnitWithConstraints('capacity-1', 'reuse', {
                            ...emptyWorkUnitResourceConstraints,
                            capacityWeight: 4
                        }),
                        workUnitWithConstraints('capacity-2', 'reuse', {
                            ...emptyWorkUnitResourceConstraints,
                            capacityWeight: 2
                        }),
                        workUnitWithConstraints('capacity-3', 'reuse', {
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
            title: 'worker-pool lanes reject invalid available parallelism',
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    workerPoolLanes({
                        availableParallelism: 1,
                        units: []
                    }),
                    []
                );
                scope.assert.throws(function createLaneWithoutPositiveParallelism() {
                    workerPoolLanes({
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

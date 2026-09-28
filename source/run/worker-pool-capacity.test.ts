import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    defaultIntegrationProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import {
    emptyWorkUnitResourceConstraints,
    type RunWorkerLifecycle,
    type WorkUnit
} from './run-types.ts';
import { createRunFacts } from './run-facts.ts';
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

function constrainedWorkUnit(
    key: string,
    workerLifecycle: RunWorkerLifecycle,
    hardKey: string,
    kind: 'serial' | 'single-worker'
): WorkUnit {
    const unit = workUnit(key, workerLifecycle);

    return {
        ...unit,
        resourceConstraints: {
            ...unit.resourceConstraints,
            serialKeys: kind === 'serial' ? [ hardKey ] : [],
            singleWorkerKeys: kind === 'single-worker' ? [ hardKey ] : []
        }
    };
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
            title: 'shared hard constraints cap worker count at one',
            body(scope: OverkillScope) {
                const singleWorkerUnits = [
                    constrainedWorkUnit('first', 'reuse', 'runtime:benchmark', 'single-worker'),
                    constrainedWorkUnit('second', 'reuse', 'runtime:benchmark', 'single-worker')
                ];
                const serialUnits = [
                    constrainedWorkUnit('first', 'reuse', 'database', 'serial'),
                    constrainedWorkUnit('second', 'reuse', 'database', 'serial')
                ];
                const unrelatedUnits = [
                    constrainedWorkUnit('first', 'reuse', 'database', 'serial'),
                    constrainedWorkUnit('second', 'reuse', 'registry', 'serial')
                ];

                scope.assert.equal(workerCount(singleWorkerUnits, 8, 6, 4), 1);
                scope.assert.equal(workerCount(serialUnits, 8, null, null), 1);
                scope.assert.equal(workerCount(unrelatedUnits, 8, null, null), 2);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'shared hard constraints reject incompatible worker lifecycles',
            body(scope: OverkillScope) {
                scope.assert.throws(function resolveSharedConstraintAcrossLifecycles() {
                    workerCount(
                        [
                            constrainedWorkUnit('reuse', 'reuse', 'runtime:benchmark', 'single-worker'),
                            constrainedWorkUnit(
                                'fresh',
                                'fresh-worker-per-unit',
                                'runtime:benchmark',
                                'single-worker'
                            )
                        ],
                        8,
                        null,
                        null
                    );
                }, { message: 'Worker-pool execution requires at least 2 workers for its worker lifecycles.' });

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
            title: 'worker-pool facts require a resolved worker count',
            body(scope: OverkillScope) {
                const profile = defaultIntegrationProfile({ execution: { maxWorkers: null } });

                scope.assert.throws(function createFactsWithoutWorkerCount() {
                    createRunFacts({
                        cases: [],
                        config: defaultRunConfig({ profiles: { integration: profile } }),
                        dependencies: {
                            createSeed() {
                                return 42n;
                            },
                            node: {
                                arch: 'test-arch',
                                platform: 'test-platform',
                                version: 'test-version'
                            }
                        },
                        durationHistory: null,
                        engine: { kind: 'default' },
                        placementPlan: null,
                        projectRoot: '/project',
                        request: defaultRunRequest({ profile: 'integration' }),
                        scheduling: profile.execution.scheduling,
                        workerCount: null
                    });
                }, { message: 'Worker-pool execution facts require worker-count resolution.' });

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

import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { emptyWorkUnitResourceConstraints, type PlacementLane, type WorkUnit } from './run-types.ts';
import { createWarmLaneAffinity } from './worker-pool-warm-lane-affinity.ts';

function lane(): PlacementLane {
    return {
        executor: {
            capabilities: [],
            capacity: 1,
            id: 'worker-1',
            kind: 'local-worker'
        },
        id: 'worker-1'
    };
}

function workUnit(key: string, file: string | null, runtimeName: string): WorkUnit {
    const runtime = {
        dimensions: {},
        name: runtimeName,
        variantId: null
    };

    return {
        group: null,
        id: { key, mode: 'file', runtimes: [ runtime ], workload: null },
        order: 'plan',
        resourceConstraints: emptyWorkUnitResourceConstraints,
        scheduling: 'concurrent',
        work: [
            {
                case: { file, params: null, suite: [], title: key },
                runtimes: [ runtime ],
                workload: null
            }
        ],
        workerLifecycle: 'reuse'
    };
}

function freshWorkerUnit(key: string, file: string): WorkUnit {
    return {
        ...workUnit(key, file, 'fresh-runtime'),
        workerLifecycle: 'fresh-worker-per-unit'
    };
}

function unitWithAffinityKey(key: string, affinityKey: string): WorkUnit {
    return {
        ...workUnit(key, `source/${key}/case.test.ts`, 'affinity-runtime'),
        resourceConstraints: {
            ...emptyWorkUnitResourceConstraints,
            affinityKeys: [ affinityKey ]
        }
    };
}

function unitWithWorkload(key: string): WorkUnit {
    const unit = workUnit(key, `source/${key}/case.test.ts`, 'workload-runtime');

    return {
        ...unit,
        id: {
            ...unit.id,
            workload: {
                name: 'database',
                params: {
                    shard: 'one',
                    zone: 'eu'
                }
            }
        }
    };
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-warm-lane-affinity.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool warm-lane affinity evicts keys after retained unit limit',
            body(scope: OverkillScope) {
                const affinity = createWarmLaneAffinity();
                const workerLane = lane();
                const expired = workUnit('expired', 'source/expired/expired.test.ts', 'expired-runtime');

                affinity.learn(workerLane, [ expired ]);
                for (let index = 0; index < 32; index += 1) {
                    affinity.learn(workerLane, [
                        workUnit(`current-${index}`, `source/current-${index}/current.test.ts`, 'current-runtime')
                    ]);
                }

                scope.assert.equal(affinity.match(workerLane, expired).score, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool warm-lane affinity scores key specificity',
            body(scope: OverkillScope) {
                const affinity = createWarmLaneAffinity();
                const workerLane = lane();

                affinity.learn(workerLane, [
                    workUnit('file', 'case.test.ts', 'file-runtime'),
                    unitWithAffinityKey('affinity', 'database'),
                    unitWithWorkload('workload')
                ]);

                scope.assert.deepEqual(
                    affinity.match(workerLane, workUnit('file-match', 'case.test.ts', 'file-runtime')),
                    {
                        kinds: [ 'file', 'runtime-workload' ],
                        score: 17
                    }
                );
                scope.assert.deepEqual(affinity.match(workerLane, unitWithAffinityKey('affinity-match', 'database')), {
                    kinds: [ 'affinity', 'runtime-workload' ],
                    score: 3
                });
                scope.assert.deepEqual(affinity.match(workerLane, unitWithWorkload('workload-match')), {
                    kinds: [ 'runtime-workload' ],
                    score: 1
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool warm-lane affinity ignores non-reusable and fileless units',
            body(scope: OverkillScope) {
                const affinity = createWarmLaneAffinity();
                const workerLane = lane();

                affinity.learn(workerLane, [
                    freshWorkerUnit('fresh', 'source/fresh/case.test.ts'),
                    workUnit('fileless', null, 'fileless-runtime')
                ]);

                scope.assert.equal(
                    affinity.match(workerLane, freshWorkerUnit('fresh-match', 'source/fresh/case.test.ts')).score,
                    0
                );
                scope.assert.deepEqual(
                    affinity.match(workerLane, workUnit('fileless-match', null, 'fileless-runtime')),
                    {
                        kinds: [ 'runtime-workload' ],
                        score: 1
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool warm-lane affinity decrements retained duplicate keys',
            body(scope: OverkillScope) {
                const affinity = createWarmLaneAffinity();
                const workerLane = lane();
                const shared = workUnit('shared', 'source/shared/case.test.ts', 'shared-runtime');

                affinity.learn(workerLane, [ shared ]);
                affinity.learn(workerLane, [
                    workUnit('shared-second', 'source/shared/case.test.ts', 'shared-runtime')
                ]);
                for (let index = 0; index < 31; index += 1) {
                    affinity.learn(workerLane, [
                        workUnit(
                            `replacement-${index}`,
                            `source/replacement-${index}/case.test.ts`,
                            'replacement-runtime'
                        )
                    ]);
                }

                scope.assert.equal(affinity.match(workerLane, shared).score, 21);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

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

function workUnit(key: string, file: string, runtimeName: string): WorkUnit {
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
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

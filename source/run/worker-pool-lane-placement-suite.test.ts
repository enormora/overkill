import { runIfMain } from '#test-runner';
import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as workerPoolLaneAffinityTestNode } from './worker-pool-lane-affinity.test.ts';
import { testNode as workerPoolCapacityTestNode } from './worker-pool-capacity.test.ts';
import { testNode as workerPoolLanesTestNode } from './worker-pool-lanes.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-lane-placement-suite.test.ts',
    children: [
        workerPoolCapacityTestNode,
        workerPoolLaneAffinityTestNode,
        workerPoolLanesTestNode
    ]
});

await runIfMain(import.meta, testNode);

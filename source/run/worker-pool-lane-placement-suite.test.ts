import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as workerPoolLaneAffinityTestNode } from './worker-pool-lane-affinity.test.ts';
import { testNode as workerPoolLanesTestNode } from './worker-pool-lanes.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-lane-placement-suite.test.ts',
    children: [
        workerPoolLaneAffinityTestNode,
        workerPoolLanesTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

import { runIfMain } from '#test-runner';
import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as placementTraceTestNode } from './placement-trace.test.ts';
import { testNode as workerPoolRuntimeEdgeTestNode } from './worker-pool-runtime-edge.test.ts';
import { testNode as workerPoolRuntimeTestNode } from './worker-pool-runtime.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-runtime-suite.test.ts',
    children: [
        placementTraceTestNode,
        workerPoolRuntimeEdgeTestNode,
        workerPoolRuntimeTestNode
    ]
});

await runIfMain(import.meta, testNode);

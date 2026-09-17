import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as workerPoolRuntimeEdgeTestNode } from './worker-pool-runtime-edge.test.ts';
import { testNode as workerPoolRuntimeTestNode } from './worker-pool-runtime.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-runtime-suite.test.ts',
    children: [
        workerPoolRuntimeEdgeTestNode,
        workerPoolRuntimeTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

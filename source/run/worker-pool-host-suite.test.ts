import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as workerPoolHostProcessEdgeTestNode } from './worker-pool-host-process-edge.test.ts';
import { testNode as workerPoolHostProcessTestNode } from './worker-pool-host-process.test.ts';
import { testNode as workerPoolHostProtocolTestNode } from './worker-pool-host-protocol.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-host-suite.test.ts',
    children: [
        workerPoolHostProcessEdgeTestNode,
        workerPoolHostProcessTestNode,
        workerPoolHostProtocolTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

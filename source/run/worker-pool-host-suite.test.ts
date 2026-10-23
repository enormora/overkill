import { runIfMain } from '#test-runner';
import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as workerPoolHostProcessEdgeTestNode } from './worker-pool-host-process-edge.test.ts';
import { testNode as workerPoolHostProcessTestNode } from './worker-pool-host-process.test.ts';
import { testNode as workerPoolHostProtocolTestNode } from './worker-pool-host-protocol.test.ts';
import { testNode as workerPoolHostTaskTestNode } from './worker-pool-host-task.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-host-suite.test.ts',
    children: [
        workerPoolHostProcessEdgeTestNode,
        workerPoolHostProcessTestNode,
        workerPoolHostProtocolTestNode,
        workerPoolHostTaskTestNode
    ]
});

await runIfMain(import.meta, testNode);

import { suite } from '@overkill-dev/test';

import { testNode as workerPoolHostProcessEdgeTestNode } from './worker-pool-host-process-edge.test.ts';
import { testNode as workerPoolHostTaskTestNode } from './worker-pool-host-task.test.ts';

export const testNode = suite('source/run/worker-pool-host-suite.test.ts', [
    workerPoolHostProcessEdgeTestNode,
    workerPoolHostTaskTestNode
]);

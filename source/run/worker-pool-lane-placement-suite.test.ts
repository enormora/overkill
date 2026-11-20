import { suite } from '@overkill-dev/test';

import { testNode as workerPoolLaneAffinityTestNode } from './worker-pool-lane-affinity.test.ts';
import { testNode as workerPoolCapacityTestNode } from './worker-pool-capacity.test.ts';
import { testNode as workerPoolLanesTestNode } from './worker-pool-lanes.test.ts';

export const testNode = suite('source/run/worker-pool-lane-placement-suite.test.ts', [
    workerPoolCapacityTestNode,
    workerPoolLaneAffinityTestNode,
    workerPoolLanesTestNode
]);

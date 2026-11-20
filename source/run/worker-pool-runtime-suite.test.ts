import { suite } from '@overkill-dev/test';

import { testNode as placementTraceTestNode } from './placement-trace.test.ts';
import { testNode as workerPoolRuntimeEdgeTestNode } from './worker-pool-runtime-edge.test.ts';
import { testNode as workerPoolRuntimeTestNode } from './worker-pool-runtime.test.ts';

export const testNode = suite('source/run/worker-pool-runtime-suite.test.ts', [
    placementTraceTestNode,
    workerPoolRuntimeEdgeTestNode,
    workerPoolRuntimeTestNode
]);

import { suite } from '@overkill-dev/test';

import { testNode as executionPlanCompatibilityTestNode } from './execution-plan-compatibility.test.ts';
import { testNode as executionPlanResolutionTestNode } from './execution-plan-resolution.test.ts';
import { testNode as workerPoolCollectionTestNode } from './worker-pool-collection.test.ts';
import { testNode as workerPoolCoreTestNode } from './worker-pool-core-suite.test.ts';
import { testNode as workerPoolHostTestNode } from './worker-pool-host-suite.test.ts';
import { testNode as workerPoolRunBoundaryTestNode } from './worker-pool-run-boundary.test.ts';
import { testNode as workerPoolWorkerTimingTestNode } from './worker-pool-worker-timing.test.ts';

export const testNode = suite('source/run/worker-pool-suite.test.ts', [
    executionPlanCompatibilityTestNode,
    executionPlanResolutionTestNode,
    workerPoolCollectionTestNode,
    workerPoolCoreTestNode,
    workerPoolHostTestNode,
    workerPoolRunBoundaryTestNode,
    workerPoolWorkerTimingTestNode
]);

import { suite } from '@overkill-dev/test';

import { testNode as workerPoolDistributionTestNode } from './worker-pool-distribution-suite.test.ts';
import { testNode as workerPoolExecutionSuiteTestNode } from './worker-pool-execution-suite.test.ts';
import { testNode as workerPoolPlacementValidationTestNode } from './worker-pool-placement-validation.test.ts';
import { testNode as workerPoolRuntimeTestNode } from './worker-pool-runtime-suite.test.ts';

export const testNode = suite('source/run/worker-pool-core-suite.test.ts', [
    workerPoolDistributionTestNode,
    workerPoolExecutionSuiteTestNode,
    workerPoolPlacementValidationTestNode,
    workerPoolRuntimeTestNode
]);

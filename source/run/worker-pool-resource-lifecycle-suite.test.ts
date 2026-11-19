import { suite } from '@overkill-dev/test';

import { testNode as workerPoolResourceLifecycleDisposalTestNode } from './worker-pool-resource-lifecycle-disposal.test.ts';
import { testNode as workerPoolResourceLifecycleExecutionTestNode } from './worker-pool-resource-lifecycle-execution.test.ts';
import { testNode as workerPoolProcessUsageTrackingTestNode } from './worker-pool-process-usage-tracking.test.ts';
import { testNode as workerPoolWorkerResourcesTestNode } from './worker-pool-worker-resources.test.ts';

export const testNode = suite('source/run/worker-pool-resource-lifecycle-suite.test.ts', [
    workerPoolResourceLifecycleDisposalTestNode,
    workerPoolResourceLifecycleExecutionTestNode,
    workerPoolProcessUsageTrackingTestNode,
    workerPoolWorkerResourcesTestNode
]);

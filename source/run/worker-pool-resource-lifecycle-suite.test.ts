import { runIfMain } from '#test-runner';
import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as workerPoolResourceLifecycleDisposalTestNode } from './worker-pool-resource-lifecycle-disposal.test.ts';
import { testNode as workerPoolResourceLifecycleExecutionTestNode } from './worker-pool-resource-lifecycle-execution.test.ts';
import { testNode as workerPoolProcessUsageTrackingTestNode } from './worker-pool-process-usage-tracking.test.ts';
import { testNode as workerPoolWorkerResourcesTestNode } from './worker-pool-worker-resources.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-resource-lifecycle-suite.test.ts',
    children: [
        workerPoolResourceLifecycleDisposalTestNode,
        workerPoolResourceLifecycleExecutionTestNode,
        workerPoolProcessUsageTrackingTestNode,
        workerPoolWorkerResourcesTestNode
    ]
});

await runIfMain(import.meta, testNode);

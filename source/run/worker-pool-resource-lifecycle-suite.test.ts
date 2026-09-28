import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as workerPoolResourceLifecycleDisposalTestNode } from './worker-pool-resource-lifecycle-disposal.test.ts';
import { testNode as workerPoolResourceLifecycleExecutionTestNode } from './worker-pool-resource-lifecycle-execution.test.ts';
import { testNode as workerPoolResourceTrackingTestNode } from './worker-pool-resource-tracking.test.ts';
import { testNode as workerPoolWorkerResourcesTestNode } from './worker-pool-worker-resources.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-resource-lifecycle-suite.test.ts',
    children: [
        workerPoolResourceLifecycleDisposalTestNode,
        workerPoolResourceLifecycleExecutionTestNode,
        workerPoolResourceTrackingTestNode,
        workerPoolWorkerResourcesTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

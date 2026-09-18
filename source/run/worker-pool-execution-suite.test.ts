import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as workerPoolExecutionStateTestNode } from './worker-pool-execution-state.test.ts';
import { testNode as workerPoolResourceTrackingTestNode } from './worker-pool-resource-tracking.test.ts';
import { testNode as workerPoolResultsTestNode } from './worker-pool-results.test.ts';
import { testNode as workerPoolWorkDispatcherTestNode } from './worker-pool-work-dispatcher.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-execution-suite.test.ts',
    children: [
        workerPoolExecutionStateTestNode,
        workerPoolResourceTrackingTestNode,
        workerPoolResultsTestNode,
        workerPoolWorkDispatcherTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

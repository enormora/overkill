import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as workerPoolCommandPlanningTestNode } from './worker-pool-command-planning.test.ts';
import { testNode as workerPoolLifecycleRoutingTestNode } from './worker-pool-lifecycle-routing.test.ts';
import { testNode as workerPoolWorkDistributionTestNode } from './worker-pool-work-distribution.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-distribution-suite.test.ts',
    children: [
        workerPoolCommandPlanningTestNode,
        workerPoolLifecycleRoutingTestNode,
        workerPoolWorkDistributionTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

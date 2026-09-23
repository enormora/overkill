import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as workerPoolDynamicHedgingTestNode } from './worker-pool-dynamic-hedging.test.ts';
import { testNode as workerPoolHedgeDispatchTestNode } from './worker-pool-hedge-dispatch.test.ts';
import { testNode as workerPoolHedgedArbitrationTestNode } from './worker-pool-hedged-arbitration.test.ts';
import { testNode as workerPoolStaticDispatcherTestNode } from './worker-pool-static-dispatcher.test.ts';
import { testNode as workerPoolTaskEventsTestNode } from './worker-pool-task-events.test.ts';
import { testNode as workerPoolWorkLoadTestNode } from './worker-pool-work-load.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-hedging-suite.test.ts',
    children: [
        workerPoolDynamicHedgingTestNode,
        workerPoolHedgeDispatchTestNode,
        workerPoolHedgedArbitrationTestNode,
        workerPoolStaticDispatcherTestNode,
        workerPoolTaskEventsTestNode,
        workerPoolWorkLoadTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

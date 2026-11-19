import { suite } from '@overkill-dev/test';

import { testNode as hedgeTiming } from './dynamic-dispatch-timing-policy.test.ts';
import { testNode as emptyPool } from './routed-pool-empty-policy.test.ts';
import { testNode as workerPoolDynamicHedgingTestNode } from './worker-pool-dynamic-hedging.test.ts';
import { testNode as workerPoolHedgeDispatchTestNode } from './worker-pool-hedge-dispatch.test.ts';
import { testNode as workerPoolHedgedArbitrationTestNode } from './worker-pool-hedged-arbitration.test.ts';
import { testNode as workerPoolStaticDispatcherTestNode } from './worker-pool-static-dispatcher.test.ts';
import { testNode as workerPoolTaskEventsTestNode } from './worker-pool-task-events.test.ts';
import { testNode as workerPoolWorkLoadTestNode } from './worker-pool-work-load.test.ts';

export const testNode = suite('source/run/worker-pool-hedging-suite.test.ts', [
    emptyPool,
    hedgeTiming,
    workerPoolDynamicHedgingTestNode,
    workerPoolHedgeDispatchTestNode,
    workerPoolHedgedArbitrationTestNode,
    workerPoolStaticDispatcherTestNode,
    workerPoolTaskEventsTestNode,
    workerPoolWorkLoadTestNode
]);

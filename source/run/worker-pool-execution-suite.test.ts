import { suite } from '@overkill-dev/test';

import { testNode as orchestration } from './worker-pool-orchestration-policy.test.ts';
import { testNode as workerPoolExecutionStateTestNode } from './worker-pool-execution-state.test.ts';
import { testNode as workerPoolHedgingSuiteTestNode } from './worker-pool-hedging-suite.test.ts';
import { testNode as workerPoolResourceLifecycleSuiteTestNode } from './worker-pool-resource-lifecycle-suite.test.ts';
import { testNode as workerPoolResultsTestNode } from './worker-pool-results.test.ts';
import { testNode as workerPoolWarmLaneDispatchTestNode } from './worker-pool-warm-lane-dispatch.test.ts';
import { testNode as workerPoolWarmLaneAffinityTestNode } from './worker-pool-warm-lane-affinity.test.ts';
import { testNode as workerPoolWorkDispatcherTestNode } from './worker-pool-work-dispatcher.test.ts';

export const testNode = suite('source/run/worker-pool-execution-suite.test.ts', [
    orchestration,
    workerPoolExecutionStateTestNode,
    workerPoolHedgingSuiteTestNode,
    workerPoolResourceLifecycleSuiteTestNode,
    workerPoolResultsTestNode,
    workerPoolWarmLaneDispatchTestNode,
    workerPoolWarmLaneAffinityTestNode,
    workerPoolWorkDispatcherTestNode
]);

import { suite } from '@overkill-dev/test';

import { testNode as workerPoolCommandPlanningTestNode } from './worker-pool-command-planning.test.ts';
import { testNode as workerPoolCommandTestNode } from './worker-pool-command.test.ts';

export const testNode = suite('source/run/worker-pool-command-suite.test.ts', [
    workerPoolCommandPlanningTestNode,
    workerPoolCommandTestNode
]);

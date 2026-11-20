import { suite } from '@overkill-dev/test';

import { testNode as workerPoolLifecycleTestNode } from '../../../../run/worker-pool-lifecycle.test.ts';
import { testNode as workerPoolPlacementTasksTestNode } from '../../../../run/worker-pool-placement-tasks.test.ts';
import { testNode as workerPoolPlanningTestNode } from '../../../../run/worker-pool-planning.test.ts';
import { testNode as workerPoolRunTestNode } from '../../../../run/worker-pool-run.test.ts';
import { testNode as workerPoolPendingSplittingTestNode } from '../../../../run/worker-pool-pending-splitting.test.ts';
import { testNode as implementationExecutionTestNode } from '../../../../run/implementation-execution.test.ts';
import { testNode as workerImplementationPlanTestNode } from '../../../../run/worker-implementation-plan.test.ts';

export const testNode = suite('runner workers placement integration', [
    workerPoolLifecycleTestNode,
    workerPoolPlacementTasksTestNode,
    workerPoolPlanningTestNode,
    workerPoolRunTestNode,
    workerPoolPendingSplittingTestNode,
    implementationExecutionTestNode,
    workerImplementationPlanTestNode
]);

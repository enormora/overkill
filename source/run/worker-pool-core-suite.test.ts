import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as workerPoolDistributionTestNode } from './worker-pool-distribution-suite.test.ts';
import { testNode as workerPoolExecutionStateTestNode } from './worker-pool-execution-state.test.ts';
import { testNode as workerPoolLifecycleTestNode } from './worker-pool-lifecycle.test.ts';
import { testNode as workerPoolPlacementTasksTestNode } from './worker-pool-placement-tasks.test.ts';
import { testNode as workerPoolPlacementValidationTestNode } from './worker-pool-placement-validation.test.ts';
import { testNode as workerPoolPlanningTestNode } from './worker-pool-planning.test.ts';
import { testNode as workerPoolRunTestNode } from './worker-pool-run.test.ts';
import { testNode as workerPoolRuntimeTestNode } from './worker-pool-runtime-suite.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-core-suite.test.ts',
    children: [
        workerPoolDistributionTestNode,
        workerPoolExecutionStateTestNode,
        workerPoolLifecycleTestNode,
        workerPoolPlacementTasksTestNode,
        workerPoolPlacementValidationTestNode,
        workerPoolPlanningTestNode,
        workerPoolRunTestNode,
        workerPoolRuntimeTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

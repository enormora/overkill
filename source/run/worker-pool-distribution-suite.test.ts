import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as workerPoolCommandSuiteTestNode } from './worker-pool-command-suite.test.ts';
import { testNode as workerPoolLanePlacementSuiteTestNode } from './worker-pool-lane-placement-suite.test.ts';
import { testNode as workerPoolLifecycleProcessUsageTestNode } from './worker-pool-lifecycle-process-usage.test.ts';
import { testNode as workerPoolLifecycleRoutingTestNode } from './worker-pool-lifecycle-routing.test.ts';
import { testNode as workerPoolPlacementPlanningTestNode } from './worker-pool-placement-planning.test.ts';
import { testNode as workerPoolWorkDistributionTestNode } from './worker-pool-work-distribution.test.ts';
import { testNode as workerPoolWorkIdentityTestNode } from './worker-pool-work-identity.test.ts';
import { testNode as workUnitResourceConstraintsTestNode } from './work-unit-resource-constraints.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-distribution-suite.test.ts',
    children: [
        workerPoolCommandSuiteTestNode,
        workerPoolLanePlacementSuiteTestNode,
        workerPoolLifecycleProcessUsageTestNode,
        workerPoolLifecycleRoutingTestNode,
        workerPoolPlacementPlanningTestNode,
        workerPoolWorkDistributionTestNode,
        workerPoolWorkIdentityTestNode,
        workUnitResourceConstraintsTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

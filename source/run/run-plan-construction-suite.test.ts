import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as benchmarkProfileBoundaryTestNode } from './benchmark-profile-boundary.test.ts';
import { testNode as collectedRunPlanTestNode } from './collected-run-plan.test.ts';
import { testNode as runShardingTestNode } from './run-sharding.test.ts';
import { testNode as runtimeMatrixExpansionTestNode } from './runtime-matrix-expansion.test.ts';

import { testNode as frozenPolicyTestNode } from './frozen-run-policy.test.ts';
import { testNode as frozenPolicyTransportTestNode } from './frozen-policy-transport.test.ts';
import { testNode as moduleBoundaryTestNode } from './file-module-boundary.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-plan-construction-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        benchmarkProfileBoundaryTestNode,
        collectedRunPlanTestNode,
        frozenPolicyTestNode,
        frozenPolicyTransportTestNode,
        moduleBoundaryTestNode,
        runShardingTestNode,
        runtimeMatrixExpansionTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('#test-runner');

await runTestFileIfMain(import.meta, testNode);

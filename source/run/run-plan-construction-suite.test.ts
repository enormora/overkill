import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as collectedRunPlanTestNode } from './collected-run-plan.test.ts';
import { testNode as runShardingTestNode } from './run-sharding.test.ts';
import { testNode as runtimeMatrixExpansionTestNode } from './runtime-matrix-expansion.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-plan-construction-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        collectedRunPlanTestNode,
        runShardingTestNode,
        runtimeMatrixExpansionTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

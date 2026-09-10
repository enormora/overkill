import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as testPlanAuthoringRulesTestNode } from '../../engine/test-plan-authoring-rules.test.ts';
import { testNode as testPlanLocationTestNode } from '../../engine/test-plan-location.test.ts';
import { testNode as testPlanTestNode } from '../../engine/test-plan.test.ts';
import { testNode as skippedTestPlanTestNode } from '../../engine/skipped-test-plan.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/test-support/unit-suite-groups/engine-planning.ts',
    annotations: {},
    controls: {},
    children: [
        testPlanAuthoringRulesTestNode,
        testPlanLocationTestNode,
        skippedTestPlanTestNode,
        testPlanTestNode
    ]
});

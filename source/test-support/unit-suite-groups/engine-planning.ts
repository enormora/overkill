import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testSuite as testPlanAuthoringRulesTestSuite } from '../../engine/test-plan-authoring-rules.test.ts';
import { testSuite as testPlanLocationTestSuite } from '../../engine/test-plan-location.test.ts';
import { testSuite as testPlanTestSuite } from '../../engine/test-plan.test.ts';

export const testSuite = createSuite({
    title: 'source/test-support/unit-suite-groups/engine-planning.ts',
    metadata: {},
    children: [
        testPlanAuthoringRulesTestSuite,
        testPlanLocationTestSuite,
        testPlanTestSuite
    ]
});

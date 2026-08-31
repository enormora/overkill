import { createSuite } from '@overkill-dev/engine';
import { testSuite as testPlanLocationTestSuite } from '../../engine/test-plan-location.test.ts';
import { testSuite as testPlanTestSuite } from '../../engine/test-plan.test.ts';

export const testSuite = createSuite({
    name: 'source/test-support/unit-suite-groups/engine-planning.ts',
    metadata: {},
    children: [
        testPlanLocationTestSuite,
        testPlanTestSuite
    ]
});

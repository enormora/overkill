import { suite } from '@overkill-dev/test';

import { testNode as testPlanSelectionTestNode } from '../../../run/test-plan-selection.test.ts';
import { testNode as runShardingTestNode } from '../../../run/run-sharding.test.ts';
import { testNode as lastFailedResolutionTestNode } from '../../../run/last-failed-resolution.test.ts';

export const testNode = suite('runner selection integration', [
    testPlanSelectionTestNode,
    runShardingTestNode,
    lastFailedResolutionTestNode
]);

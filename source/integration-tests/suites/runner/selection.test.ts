import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as testPlanSelectionTestNode } from '../../../run/test-plan-selection.test.ts';
import { testNode as runShardingTestNode } from '../../../run/run-sharding.test.ts';
import { testNode as lastFailedResolutionTestNode } from '../../../run/last-failed-resolution.test.ts';

export const testNode = createSuite({
    title: 'runner selection integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        testPlanSelectionTestNode,
        runShardingTestNode,
        lastFailedResolutionTestNode
    ]
});

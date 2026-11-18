import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as familyProfileTestNode } from '../../../config/family-profile.test.ts';
import { testNode as frozenRunPolicyTestNode } from '../../../run/frozen-run-policy.test.ts';

export const testNode = createSuite({
    title: 'runner configuration integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        familyProfileTestNode,
        frozenRunPolicyTestNode
    ]
});

import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as campaignsTestNode } from './stryker/campaigns.test.ts';
import { testNode as evidenceTestNode } from './stryker/evidence.test.ts';
import { testNode as lifecycleTestNode } from './stryker/lifecycle.test.ts';

export const testNode = createSuite({
    title: 'stryker integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ campaignsTestNode, evidenceTestNode, lifecycleTestNode ]
});

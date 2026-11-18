import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as hostsTestNode } from './workers/hosts.test.ts';
import { testNode as placementTestNode } from './workers/placement.test.ts';

export const testNode = createSuite({
    title: 'runner workers integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ hostsTestNode, placementTestNode ]
});

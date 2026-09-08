import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as resourcesTestNode } from '../../resources/resources.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'resources',
    metadata: {},
    children: [
        resourcesTestNode
    ]
});

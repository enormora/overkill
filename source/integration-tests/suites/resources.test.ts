import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as httpTestNode } from './resources/http.test.ts';
import { testNode as lifecycleTestNode } from './resources/lifecycle.test.ts';

export const testNode = createSuite({
    title: 'resources integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ httpTestNode, lifecycleTestNode ]
});

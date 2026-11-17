import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as directEntrypointCollectionTestNode } from '../../../run/direct-entrypoint-collection.test.ts';
import { testNode as initializedRunTestNode } from '../../../run/initialized-run.test.ts';

export const testNode = createSuite({
    title: 'runner collection integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ directEntrypointCollectionTestNode, initializedRunTestNode ]
});

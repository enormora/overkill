import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as cancellationTestNode } from './engine/cancellation.test.ts';
import { testNode as implementationsTestNode } from './engine/implementations.test.ts';
import { testNode as runtimeTestNode } from './engine/runtime.test.ts';

export const testNode = createSuite({
    title: 'engine integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ cancellationTestNode, implementationsTestNode, runtimeTestNode ]
});

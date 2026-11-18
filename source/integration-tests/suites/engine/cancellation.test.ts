import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as linearizabilityTestNode } from '../../../linearizability/linearizability.test.ts';
import { testNode as asyncControlTestNode } from '../../../engine/async-control.test.ts';

export const testNode = createSuite({
    title: 'engine cancellation integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ linearizabilityTestNode, asyncControlTestNode ]
});

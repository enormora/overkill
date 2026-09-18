import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as simulatedHttpServerTestNode } from '../../simulation/simulated-http-server.test.ts';
import { testNode as simulationTestNode } from '../../simulation/simulation.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'simulation',
    annotations: {},
    controls: {},
    children: [
        simulationTestNode,
        simulatedHttpServerTestNode
    ]
});

import { testNode as histories } from '../../linearizability/history-policy.test.ts';
import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as simulationTestNode } from '../../simulation/simulation.test.ts';
import { testNode as transcriptStoreTestNode } from '../../transcript/transcript-store.test.ts';

import { testNode as routing } from '../../simulation/simulated-http-routing.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'simulation',
    annotations: {},
    controls: {},
    children: [ histories, simulationTestNode, transcriptStoreTestNode, routing ]
});

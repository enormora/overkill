import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as runnerReplayWitnessTestNode } from '../../run/runner-replay-witness.test.ts';
import { testNode as replayWitnessInputTestNode } from '../../../run/replay-witness-input.test.ts';
import { testNode as propertyWitnessStorageTestNode } from '../../../run/property-witness-storage.test.ts';

export const testNode = createSuite({
    title: 'persistence witnesses integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        runnerReplayWitnessTestNode,
        replayWitnessInputTestNode,
        propertyWitnessStorageTestNode
    ]
});

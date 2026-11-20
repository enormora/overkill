import { suite } from '@overkill-dev/test';

import { testNode as runnerReplayWitnessTestNode } from '../../run/runner-replay-witness.test.ts';
import { testNode as replayWitnessInputTestNode } from '../../../run/replay-witness-input.test.ts';
import { testNode as propertyWitnessStorageTestNode } from '../../../run/property-witness-storage.test.ts';

export const testNode = suite('persistence witnesses integration', [
    runnerReplayWitnessTestNode,
    replayWitnessInputTestNode,
    propertyWitnessStorageTestNode
]);

import { suite } from '@overkill-dev/test';
import { testNode as histories } from '../../linearizability/history-policy.test.ts';

import { testNode as simulationTestNode } from '../../simulation/simulation.test.ts';
import { testNode as transcriptStoreTestNode } from '../../transcript/transcript-store.test.ts';

import { testNode as routing } from '../../simulation/simulated-http-routing.test.ts';

export const testNode = suite('simulation', [ histories, simulationTestNode, transcriptStoreTestNode, routing ]);

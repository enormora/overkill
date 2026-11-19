import { suite } from '@overkill-dev/test';

import { testNode as linearizabilityTestNode } from '../../../linearizability/linearizability.test.ts';
import { testNode as asyncControlTestNode } from '../../../engine/async-control.test.ts';

export const testNode = suite('engine cancellation integration', [ linearizabilityTestNode, asyncControlTestNode ]);

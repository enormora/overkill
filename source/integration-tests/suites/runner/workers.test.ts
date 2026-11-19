import { suite } from '@overkill-dev/test';

import { testNode as hostsTestNode } from './workers/hosts.test.ts';
import { testNode as placementTestNode } from './workers/placement.test.ts';

export const testNode = suite('runner workers integration', [ hostsTestNode, placementTestNode ]);

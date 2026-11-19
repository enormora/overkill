import { suite } from '@overkill-dev/test';

import { testNode as campaignsTestNode } from './stryker/campaigns.test.ts';
import { testNode as evidenceTestNode } from './stryker/evidence.test.ts';
import { testNode as lifecycleTestNode } from './stryker/lifecycle.test.ts';

export const testNode = suite('stryker integration', [ campaignsTestNode, evidenceTestNode, lifecycleTestNode ]);

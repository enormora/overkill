import { suite } from '@overkill-dev/test';

import { testNode as planning } from './benchmark-placement-planning.test.ts';
import { testNode as placementTestNode } from './benchmark-placement.test.ts';

export const testNode = suite('adaptive benchmark placement', [ planning, placementTestNode ]);

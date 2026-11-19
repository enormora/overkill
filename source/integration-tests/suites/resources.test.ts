import { suite } from '@overkill-dev/test';

import { testNode as httpTestNode } from './resources/http.test.ts';
import { testNode as lifecycleTestNode } from './resources/lifecycle.test.ts';

export const testNode = suite('resources integration', [ httpTestNode, lifecycleTestNode ]);

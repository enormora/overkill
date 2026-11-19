import { suite } from '@overkill-dev/test';

import { testNode as collectionTestNode } from './collection.test.ts';
import { testNode as sessionsTestNode } from './sessions.test.ts';
import { testNode as executionTestNode } from './execution.test.ts';
import { testNode as familiesTestNode } from './families.test.ts';
import { testNode as workersTestNode } from './workers.test.ts';

export const testNode = suite('runner runtime integration', [
    collectionTestNode,
    sessionsTestNode,
    executionTestNode,
    familiesTestNode,
    workersTestNode
]);

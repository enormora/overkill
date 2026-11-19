import { suite } from '@overkill-dev/test';

import { testNode as cancellationTestNode } from './engine/cancellation.test.ts';
import { testNode as implementationsTestNode } from './engine/implementations.test.ts';
import { testNode as runtimeTestNode } from './engine/runtime.test.ts';

export const testNode = suite('engine integration', [ cancellationTestNode, implementationsTestNode, runtimeTestNode ]);

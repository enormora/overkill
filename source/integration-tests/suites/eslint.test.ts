import { suite } from '@overkill-dev/test';

import { testNode as configurationTestNode } from './eslint/configuration.test.ts';
import { testNode as rulesTestNode } from './eslint/rules.test.ts';

export const testNode = suite('eslint integration', [ configurationTestNode, rulesTestNode ]);

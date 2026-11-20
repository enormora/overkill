import { suite } from '@overkill-dev/test';

import { testNode as commandsTestNode } from './commands.test.ts';
import { testNode as selectionTestNode } from './selection.test.ts';
import { testNode as configurationTestNode } from './configuration.test.ts';

export const testNode = suite('runner cli integration', [ commandsTestNode, selectionTestNode, configurationTestNode ]);

import { suite } from '@overkill-dev/test';

import { testNode as replayExecution } from './replay-suite.test.ts';

export const testNode = suite('history commands', [ replayExecution ]);

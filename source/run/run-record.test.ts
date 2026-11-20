import { suite } from '@overkill-dev/test';

import { testNode as mergeResults } from './merge-results-suite.test.ts';
import { testNode as session } from './run-record-session.test.ts';

export const testNode = suite('run record persistence', [ mergeResults, session ]);

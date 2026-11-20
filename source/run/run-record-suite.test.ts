import { suite } from '@overkill-dev/test';

import { testNode as resultTestNode } from './run-record-result.test.ts';
import { testNode as recordTestNode } from './run-record.test.ts';

export const testNode = suite('source/run/run-record-suite.test.ts', [ resultTestNode, recordTestNode ]);

import { suite } from '@overkill-dev/test';

import { testNode as collection } from './coverage-collection.test.ts';
import { testNode as recordSuiteTestNode } from './run-record-suite.test.ts';

export const testNode = suite('source/run/coverage-suite.test.ts', [ collection, recordSuiteTestNode ]);

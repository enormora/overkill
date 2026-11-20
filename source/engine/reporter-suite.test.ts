import { suite } from '@overkill-dev/test';

import { testNode as reporterManagedOutputTestNode } from './reporter-managed-output.test.ts';
import { testNode as reporterTestNode } from './reporter.test.ts';

export const testNode = suite('source/engine/reporter-suite.test.ts', [
    reporterTestNode,
    reporterManagedOutputTestNode
]);

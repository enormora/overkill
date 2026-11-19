import { suite } from '@overkill-dev/test';

import { testNode as processUsageTestNode } from './process-usage.test.ts';
import { testNode as runProcessUsagePolicyTestNode } from './run-process-usage-policy.test.ts';

export const testNode = suite('source/run/process-usage-suite.test.ts', [
    processUsageTestNode,
    runProcessUsagePolicyTestNode
]);

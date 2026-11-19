import { suite } from '@overkill-dev/test';

import { testNode as executionConcurrentReportingTestNode } from './execution-concurrent-reporting.test.ts';
import { testNode as executionReportingTestNode } from './execution-reporting.test.ts';
import { testNode as executionProcessUsageTestNode } from './execution-process-usage.test.ts';
import { testNode as executionTestNode } from './execution.test.ts';
import { testNode as executionSupervisionTestNode } from './execution-supervision-suite.test.ts';
import { testNode as skippedTestExecutionTestNode } from './skipped-test-execution.test.ts';
import { testNode as throwingTestExecutionTestNode } from './throwing-test-execution.test.ts';
import { testNode as randomTestNode } from './case-random.test.ts';

export const testNode = suite('source/engine/execution-suite.test.ts', [
    randomTestNode,
    executionSupervisionTestNode,
    executionConcurrentReportingTestNode,
    executionReportingTestNode,
    executionProcessUsageTestNode,
    skippedTestExecutionTestNode,
    throwingTestExecutionTestNode,
    executionTestNode
]);

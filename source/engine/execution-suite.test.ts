import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import { createSuite as createOverkillSuite, runIfMain } from '../packages/engine/engine.entry-point.ts';
import { testSuite as executionConcurrentReportingTestSuite } from './execution-concurrent-reporting.test.ts';
import { testSuite as executionReportingTestSuite } from './execution-reporting.test.ts';
import { testSuite as executionResourceUsageTestSuite } from './execution-resource-usage.test.ts';
import { testSuite as executionTestSuite } from './execution.test.ts';
import { testSuite as executionTimeoutSupervisionTestSuite } from './execution-timeout-supervision.test.ts';

export const testSuite = createOverkillSuite({
    title: 'source/engine/execution-suite.test.ts',
    metadata: {},
    children: [
        executionConcurrentReportingTestSuite,
        executionReportingTestSuite,
        executionResourceUsageTestSuite,
        executionTimeoutSupervisionTestSuite,
        executionTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });

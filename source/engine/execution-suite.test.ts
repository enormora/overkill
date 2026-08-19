import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import { createSuite as createOverkillSuite, runIfMain } from '@overkill-dev/engine';
import { testSuite as executionConcurrentReportingTestSuite } from './execution-concurrent-reporting.test.ts';
import { testSuite as executionReportingTestSuite } from './execution-reporting.test.ts';
import { testSuite as executionResourceUsageTestSuite } from './execution-resource-usage.test.ts';
import { testSuite as executionTestSuite } from './execution.test.ts';

export const testSuite = createOverkillSuite({
    name: 'source/engine/execution-suite.test.ts',
    metadata: {},
    children: [
        executionConcurrentReportingTestSuite,
        executionReportingTestSuite,
        executionResourceUsageTestSuite,
        executionTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });

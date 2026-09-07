import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testSuite as executionConcurrentReportingTestSuite } from './execution-concurrent-reporting.test.ts';
import { testSuite as executionReportingTestSuite } from './execution-reporting.test.ts';
import { testSuite as executionResourceUsageTestSuite } from './execution-resource-usage.test.ts';
import { testSuite as executionTestSuite } from './execution.test.ts';
import { testSuite as executionTimeoutSupervisionTestSuite } from './execution-timeout-supervision.test.ts';

export const testSuite = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
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

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testSuite);

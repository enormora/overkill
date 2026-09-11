import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as executionConcurrentReportingTestNode } from './execution-concurrent-reporting.test.ts';
import { testNode as executionReportingTestNode } from './execution-reporting.test.ts';
import { testNode as executionResourceUsageTestNode } from './execution-resource-usage.test.ts';
import { testNode as executionTestNode } from './execution.test.ts';
import { testNode as executionTimeoutSupervisionTestNode } from './execution-timeout-supervision.test.ts';
import { testNode as skippedTestExecutionTestNode } from './skipped-test-execution.test.ts';
import { testNode as throwingTestExecutionTestNode } from './throwing-test-execution.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/execution-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        executionConcurrentReportingTestNode,
        executionReportingTestNode,
        executionResourceUsageTestNode,
        skippedTestExecutionTestNode,
        throwingTestExecutionTestNode,
        executionTimeoutSupervisionTestNode,
        executionTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

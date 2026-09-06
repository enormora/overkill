import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testSuite as resourceUsageTestSuite } from './resource-usage.test.ts';
import { testSuite as runResourceUsagePolicyTestSuite } from './run-resource-usage-policy.test.ts';

export const testSuite = createOverkillSuite({
    title: 'source/run/resource-usage-suite.test.ts',
    metadata: {},
    children: [
        resourceUsageTestSuite,
        runResourceUsagePolicyTestSuite
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testSuite);

import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import { createSuite as createOverkillSuite, runIfMain } from '../packages/engine/engine.entry-point.ts';
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

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });

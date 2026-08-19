import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import { createSuite as createOverkillSuite, runIfMain } from '@overkill-dev/engine';
import { testSuite as resourceUsageTestSuite } from './resource-usage.test.ts';
import { testSuite as runResourceUsagePolicyTestSuite } from './run-resource-usage-policy.test.ts';

export const testSuite = createOverkillSuite({
    name: 'source/run/resource-usage-suite.test.ts',
    metadata: {},
    children: [
        resourceUsageTestSuite,
        runResourceUsagePolicyTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });

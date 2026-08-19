import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import { createSuite as createOverkillSuite, runIfMain } from '@overkill-dev/engine';
import { testSuite as commandLineRunnerTestSuite } from './command-line-runner-suite.test.ts';
import { testSuite as resourceUsageTestSuite } from './resource-usage-suite.test.ts';
import { testSuite as runConfigTestSuite } from './run-config.test.ts';
import { testSuite as runDiscoveryTestSuite } from './run-discovery.test.ts';
import { testSuite as runTestModulesTestSuite } from './run-test-modules.test.ts';
import { testSuite as runTestSuite } from './run.test.ts';
import { testSuite as supervisedRunTestSuite } from './supervised-run.test.ts';

export const testSuite = createOverkillSuite({
    name: 'source/run/run-suite.test.ts',
    metadata: {},
    children: [
        commandLineRunnerTestSuite,
        resourceUsageTestSuite,
        runConfigTestSuite,
        runDiscoveryTestSuite,
        runTestModulesTestSuite,
        runTestSuite,
        supervisedRunTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });

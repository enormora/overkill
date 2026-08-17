import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import { createSuite as createOverkillSuite, runIfMain } from '@overkill-dev/engine';
import { testSuite as commandLineRunnerNamespaceTestSuite } from './command-line-runner-namespace.test.ts';
import { testSuite as commandLineRunnerRunTestsTestSuite } from './command-line-runner.test.ts';

export const testSuite = createOverkillSuite({
    name: 'source/run/command-line-runner-suite.test.ts',
    metadata: {},
    children: [
        commandLineRunnerNamespaceTestSuite,
        commandLineRunnerRunTestsTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });

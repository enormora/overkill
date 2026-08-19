import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import { createSuite as createOverkillSuite, runIfMain } from '@overkill-dev/engine';
import { testSuite as commandLineCommandNamespaceTestSuite } from './command-line-command-namespace.test.ts';
import { testSuite as commandLineRunnerErrorTestSuite } from './command-line-runner-error.test.ts';
import { testSuite as commandLineRunnerResourceUsageTestSuite } from './command-line-runner-resource-usage.test.ts';
import { testSuite as commandLineUnimplementedCommandsTestSuite } from './command-line-unimplemented-commands.test.ts';
import { testSuite as commandLineRunnerRunTestsTestSuite } from './command-line-runner.test.ts';

export const testSuite = createOverkillSuite({
    name: 'source/run/command-line-runner-suite.test.ts',
    metadata: {},
    children: [
        commandLineCommandNamespaceTestSuite,
        commandLineRunnerErrorTestSuite,
        commandLineRunnerResourceUsageTestSuite,
        commandLineUnimplementedCommandsTestSuite,
        commandLineRunnerRunTestsTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });

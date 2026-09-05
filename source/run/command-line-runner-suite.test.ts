import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import { createSuite as createOverkillSuite, runIfMain } from '../packages/engine/engine.entry-point.ts';
import { testSuite as commandLineFallbackDiagnosticsTestSuite } from './command-line-fallback-diagnostics.test.ts';
import { testSuite as commandLineCommandTestSuite } from './command-line-command.test.ts';
import { testSuite as commandLineCommandNamespaceTestSuite } from './command-line-command-namespace.test.ts';
import { testSuite as commandLineRunnerErrorTestSuite } from './command-line-runner-error.test.ts';
import { testSuite as commandLineRunnerReporterResolutionTestSuite } from './command-line-runner-reporter-resolution.test.ts';
import { testSuite as commandLineRunnerResourceUsageTestSuite } from './command-line-runner-resource-usage.test.ts';
import { testSuite as commandLineUnimplementedCommandsTestSuite } from './command-line-unimplemented-commands.test.ts';
import { testSuite as commandLineRunnerRunTestsTestSuite } from './command-line-runner.test.ts';

export const testSuite = createOverkillSuite({
    title: 'source/run/command-line-runner-suite.test.ts',
    metadata: {},
    children: [
        commandLineCommandTestSuite,
        commandLineCommandNamespaceTestSuite,
        commandLineFallbackDiagnosticsTestSuite,
        commandLineRunnerErrorTestSuite,
        commandLineRunnerReporterResolutionTestSuite,
        commandLineRunnerResourceUsageTestSuite,
        commandLineUnimplementedCommandsTestSuite,
        commandLineRunnerRunTestsTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });

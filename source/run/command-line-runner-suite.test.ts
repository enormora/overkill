import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as commandLineFallbackDiagnosticsTestNode } from './command-line-fallback-diagnostics.test.ts';
import { testNode as commandLineCommandTestNode } from './command-line-command.test.ts';
import { testNode as commandLineCommandNamespaceTestNode } from './command-line-command-namespace.test.ts';
import { testNode as commandLineRunnerErrorTestNode } from './command-line-runner-error.test.ts';
import { testNode as commandLineRunnerReporterResolutionTestNode } from './command-line-runner-reporter-resolution.test.ts';
import { testNode as commandLineRunnerResourceUsageTestNode } from './command-line-runner-resource-usage.test.ts';
import { testNode as commandLineUnimplementedCommandsTestNode } from './command-line-unimplemented-commands.test.ts';
import { testNode as commandLineRunnerRunTestsTestNode } from './command-line-runner.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/run/command-line-runner-suite.test.ts',
    metadata: {},
    children: [
        commandLineCommandTestNode,
        commandLineCommandNamespaceTestNode,
        commandLineFallbackDiagnosticsTestNode,
        commandLineRunnerErrorTestNode,
        commandLineRunnerReporterResolutionTestNode,
        commandLineRunnerResourceUsageTestNode,
        commandLineUnimplementedCommandsTestNode,
        commandLineRunnerRunTestsTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

import { suite } from '@overkill-dev/test';

import { testNode as commandLineFallbackDiagnosticsTestNode } from './command-line-fallback-diagnostics.test.ts';
import { testNode as commandLineCommandTestNode } from './command-line-command-suite.test.ts';
import { testNode as commandLineRunnerErrorTestNode } from './command-line-runner-error.test.ts';
import { testNode as commandLineRunnerReporterResolutionTestNode } from './command-line-runner-reporter-resolution.test.ts';
import { testNode as commandLineRunnerProcessUsageTestNode } from './command-line-runner-process-usage.test.ts';
import { testNode as commandLineRunnerRunTestsTestNode } from './command-line-runner.test.ts';

export const testNode = suite('source/run/command-line-runner-suite.test.ts', [
    commandLineCommandTestNode,
    commandLineFallbackDiagnosticsTestNode,
    commandLineRunnerErrorTestNode,
    commandLineRunnerReporterResolutionTestNode,
    commandLineRunnerProcessUsageTestNode,
    commandLineRunnerRunTestsTestNode
]);

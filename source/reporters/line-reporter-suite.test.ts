import { suite } from '@overkill-dev/test';

import { testNode as retryPolicy } from './line-retry-policy.test.ts';
import { testNode as lineReporterArtifactsTestNode } from './line-reporter-artifacts.test.ts';
import { testNode as lineReporterOrphanTestNode } from './line-reporter-orphan.test.ts';
import { testNode as lineReporterProgressTestNode } from './line-reporter-progress.test.ts';
import { testNode as lineReporterSummaryTestNode } from './line-reporter-summary.test.ts';
import { testNode as lineReporterTerminalTestNode } from './line-reporter-terminal.test.ts';
import { testNode as lineReporterTestNode } from './line-reporter.test.ts';

export const testNode = suite('source/reporters/line-reporter-suite.test.ts', [
    retryPolicy,
    lineReporterTestNode,
    lineReporterProgressTestNode,
    lineReporterArtifactsTestNode,
    lineReporterSummaryTestNode,
    lineReporterTerminalTestNode,
    lineReporterOrphanTestNode
]);

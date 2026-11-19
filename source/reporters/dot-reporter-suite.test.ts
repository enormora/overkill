import { suite } from '@overkill-dev/test';

import { testNode as dotReporterInterruptedSummaryTestNode } from './dot-reporter-interrupted-summary.test.ts';
import { testNode as dotReporterOrderingTestNode } from './dot-reporter-ordering.test.ts';
import { testNode as dotReporterTerminalTestNode } from './dot-reporter-terminal.test.ts';
import { testNode as dotReporterTimingTestNode } from './dot-reporter-timing.test.ts';
import { testNode as dotReporterTestNode } from './dot-reporter.test.ts';
import { testNode as retryReportingTestNode } from './retry-reporting.test.ts';

export const testNode = suite('source/reporters/dot-reporter-suite.test.ts', [
    retryReportingTestNode,
    dotReporterInterruptedSummaryTestNode,
    dotReporterOrderingTestNode,
    dotReporterTerminalTestNode,
    dotReporterTimingTestNode,
    dotReporterTestNode
]);

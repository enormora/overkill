import { suite } from '@overkill-dev/test';

import { testNode as benchmarkHtmlTestNode } from './benchmark-html-suite.test.ts';
import { testNode as nullReporterTestNode } from './null-reporter.test.ts';
import { testNode as openTelemetryReporterTestNode } from './opentelemetry-reporter.test.ts';
import { testNode as tapConsoleReporterTestNode } from './tap-console-reporter.test.ts';
import { testNode as terminalTestNode } from './terminal.test.ts';

export const testNode = suite('source/reporters/misc-reporter-suite.test.ts', [
    benchmarkHtmlTestNode,
    nullReporterTestNode,
    openTelemetryReporterTestNode,
    tapConsoleReporterTestNode,
    terminalTestNode
]);

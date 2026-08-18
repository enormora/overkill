import { createSuite } from '@overkill-dev/engine';
import { testSuite as briefReporterTestSuite } from '../../reporters/brief-reporter.test.ts';
import { testSuite as dotReporterTestSuite } from '../../reporters/dot-reporter.test.ts';
import { testSuite as inMemoryReporterTestSuite } from '../../reporters/in-memory-reporter.test.ts';
import { testSuite as lineFailureRenderingEdgeTestSuite } from '../../reporters/line-failure-rendering-edge.test.ts';
import { testSuite as lineFailureRenderingTestSuite } from '../../reporters/line-failure-rendering.test.ts';
import { testSuite as lineReporterTestSuite } from '../../reporters/line-reporter.test.ts';
import { testSuite as nullReporterTestSuite } from '../../reporters/null-reporter.test.ts';
import { testSuite as tapConsoleReporterTestSuite } from '../../reporters/tap-console-reporter.test.ts';
import { testSuite as terminalTestSuite } from '../../reporters/terminal.test.ts';

export const testSuite = createSuite({
    name: 'source/test-support/unit-suite-groups/reporters.ts',
    metadata: {},
    children: [
        briefReporterTestSuite,
        dotReporterTestSuite,
        inMemoryReporterTestSuite,
        lineFailureRenderingEdgeTestSuite,
        lineFailureRenderingTestSuite,
        lineReporterTestSuite,
        nullReporterTestSuite,
        tapConsoleReporterTestSuite,
        terminalTestSuite
    ]
});

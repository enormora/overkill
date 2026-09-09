import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as briefReporterTestNode } from '../../reporters/brief-reporter.test.ts';
import { testNode as dotReporterTestNode } from '../../reporters/dot-reporter-suite.test.ts';
import { testNode as inMemoryReporterTestNode } from '../../reporters/in-memory-reporter.test.ts';
import { testNode as lineFailureRenderingEdgeTestNode } from '../../reporters/line-failure-rendering-edge.test.ts';
import { testNode as lineFailureRenderingTestNode } from '../../reporters/line-failure-rendering.test.ts';
import { testNode as lineReporterTestNode } from '../../reporters/line-reporter-suite.test.ts';
import { testNode as nullReporterTestNode } from '../../reporters/null-reporter.test.ts';
import { testNode as tapConsoleReporterTestNode } from '../../reporters/tap-console-reporter.test.ts';
import { testNode as terminalTestNode } from '../../reporters/terminal.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/test-support/unit-suite-groups/reporters.ts',
    annotations: {},
    controls: {},
    children: [
        briefReporterTestNode,
        dotReporterTestNode,
        inMemoryReporterTestNode,
        lineFailureRenderingEdgeTestNode,
        lineFailureRenderingTestNode,
        lineReporterTestNode,
        nullReporterTestNode,
        tapConsoleReporterTestNode,
        terminalTestNode
    ]
});

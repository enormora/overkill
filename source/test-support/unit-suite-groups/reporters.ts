import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as briefReporterTestNode } from '../../reporters/brief-reporter.test.ts';
import { testNode as dotReporterTestNode } from '../../reporters/dot-reporter-suite.test.ts';
import { testNode as humanReporterRenderingTestNode } from '../../reporters/human-reporter-rendering.test.ts';
import { testNode as inMemoryReporterTestNode } from '../../reporters/in-memory-reporter.test.ts';
import { testNode as lineFailureRenderingEdgeTestNode } from '../../reporters/line-failure-rendering-edge.test.ts';
import { testNode as lineFailureRenderingTestNode } from '../../reporters/line-failure-rendering.test.ts';
import { testNode as lineReporterTestNode } from '../../reporters/line-reporter-suite.test.ts';
import { testNode as miscReporterSuiteTestNode } from '../../reporters/misc-reporter-suite.test.ts';
import { testNode as treeProgressReporterSuiteTestNode } from '../../reporters/tree-progress-reporter-suite.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/test-support/unit-suite-groups/reporters.ts',
    annotations: {},
    controls: {},
    children: [
        briefReporterTestNode,
        dotReporterTestNode,
        humanReporterRenderingTestNode,
        inMemoryReporterTestNode,
        lineFailureRenderingEdgeTestNode,
        lineFailureRenderingTestNode,
        lineReporterTestNode,
        miscReporterSuiteTestNode,
        treeProgressReporterSuiteTestNode
    ]
});

import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as lineReporterOrphanTestNode } from './line-reporter-orphan.test.ts';
import { testNode as lineReporterSummaryTestNode } from './line-reporter-summary.test.ts';
import { testNode as lineReporterTerminalTestNode } from './line-reporter-terminal.test.ts';
import { testNode as lineReporterTestNode } from './line-reporter.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/line-reporter-suite.test.ts',
    metadata: {},
    children: [
        lineReporterTestNode,
        lineReporterSummaryTestNode,
        lineReporterTerminalTestNode,
        lineReporterOrphanTestNode
    ]
});

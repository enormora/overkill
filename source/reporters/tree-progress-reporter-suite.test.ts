import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as progressReporterTestNode } from './progress-reporter.test.ts';
import { testNode as treeReporterTestNode } from './tree-reporter.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/tree-progress-reporter-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        progressReporterTestNode,
        treeReporterTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

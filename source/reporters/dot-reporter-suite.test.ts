import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as dotReporterOrderingTestNode } from './dot-reporter-ordering.test.ts';
import { testNode as dotReporterTestNode } from './dot-reporter.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/reporters/dot-reporter-suite.test.ts',
    metadata: {},
    children: [
        dotReporterOrderingTestNode,
        dotReporterTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

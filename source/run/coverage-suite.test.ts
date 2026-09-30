import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as coverageReportingTestNode } from './coverage-reporting.test.ts';
import { testNode as runCoverageTestNode } from './run-coverage.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/coverage-suite.test.ts',
    annotations: {},
    controls: {},
    children: [ coverageReportingTestNode, runCoverageTestNode ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

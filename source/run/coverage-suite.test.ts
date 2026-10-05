import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as recordSuiteTestNode } from './run-record-suite.test.ts';
import { testNode as coverageReportingTestNode } from './coverage-reporting.test.ts';
import { testNode as recordedCoverageTestNode } from './recorded-coverage-run.test.ts';
import { testNode as localCoverageTestNode } from './run-local-coverage.test.ts';
import { testNode as supervisedCoverageTestNode } from './run-supervised-coverage.test.ts';
import { testNode as supervisedFinalizationTestNode } from './run-supervised-finalization.test.ts';
import { testNode as sessionTestNode } from './recorded-coverage-session.test.ts';
import { testNode as runCoverageTestNode } from './run-coverage.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/coverage-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        recordSuiteTestNode,
        localCoverageTestNode,
        sessionTestNode,
        supervisedFinalizationTestNode,
        supervisedCoverageTestNode,
        coverageReportingTestNode,
        runCoverageTestNode,
        recordedCoverageTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

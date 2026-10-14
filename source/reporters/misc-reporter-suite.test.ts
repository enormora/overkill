import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as benchmarkHtmlBaselinesTestNode } from './benchmark-html-baselines.test.ts';
import { testNode as benchmarkHtmlEvidenceTestNode } from './benchmark-html-evidence.test.ts';
import { testNode as benchmarkHtmlDistributionTestNode } from './benchmark-html-distribution.test.ts';
import { testNode as benchmarkHtmlReporterTestNode } from './benchmark-html-reporter.test.ts';
import { testNode as nullReporterTestNode } from './null-reporter.test.ts';
import { testNode as openTelemetryReporterTestNode } from './opentelemetry-reporter.test.ts';
import { testNode as tapConsoleReporterTestNode } from './tap-console-reporter.test.ts';
import { testNode as terminalTestNode } from './terminal.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/misc-reporter-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        benchmarkHtmlBaselinesTestNode,
        benchmarkHtmlDistributionTestNode,
        benchmarkHtmlEvidenceTestNode,
        benchmarkHtmlReporterTestNode,
        nullReporterTestNode,
        openTelemetryReporterTestNode,
        tapConsoleReporterTestNode,
        terminalTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

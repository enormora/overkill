import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as benchmarkHtmlTestNode } from './benchmark-html-suite.test.ts';
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
        benchmarkHtmlTestNode,
        nullReporterTestNode,
        openTelemetryReporterTestNode,
        tapConsoleReporterTestNode,
        terminalTestNode
    ]
});

await runIfMain(import.meta, testNode);

import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as nullReporterTestNode } from './null-reporter.test.ts';
import { testNode as tapConsoleReporterTestNode } from './tap-console-reporter.test.ts';
import { testNode as terminalTestNode } from './terminal.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/misc-reporter-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        nullReporterTestNode,
        tapConsoleReporterTestNode,
        terminalTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

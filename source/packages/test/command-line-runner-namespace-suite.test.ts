import { createSuite } from '../engine/engine.entry-point.ts';
import { testNode as commandLineRunnerBenchTestNode } from './command-line-runner-bench.test.ts';
import { testNode as commandLineRunnerHelpTestNode } from './command-line-runner-help.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/command-line-runner-namespace-suite.test.ts',
    annotations: {},
    controls: {},
    children: [ commandLineRunnerBenchTestNode, commandLineRunnerHelpTestNode ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

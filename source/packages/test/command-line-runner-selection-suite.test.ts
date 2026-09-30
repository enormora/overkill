import { createSuite } from '../engine/engine.entry-point.ts';
import { testNode as commandLineRunnerRuntimeSelectionTestNode } from './command-line-runner-runtime-selection.test.ts';
import { testNode as commandLineRunnerTestNode } from './command-line-runner.test.ts';

export const testNode = createSuite({
    annotations: {},
    children: [ commandLineRunnerTestNode, commandLineRunnerRuntimeSelectionTestNode ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/command-line-runner-selection-suite.test.ts'
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as commandLineListRunnerErrorsTestNode } from './command-line-list-runner-errors.test.ts';
import { testNode as commandLineListRunnerTestNode } from './command-line-list-runner.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/command-line-list-runner-suite.test.ts',
    children: [
        commandLineListRunnerErrorsTestNode,
        commandLineListRunnerTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

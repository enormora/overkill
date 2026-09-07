import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as runIfMainOptionsTestNode } from './run-if-main-options.test.ts';
import { testNode as runIfMainSelectionTestNode } from './run-if-main-selection.test.ts';
import { testNode as runIfMainTestNode } from './run-if-main.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/run/run-if-main-suite.test.ts',
    metadata: {},
    children: [
        runIfMainOptionsTestNode,
        runIfMainSelectionTestNode,
        runIfMainTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testSuite as runIfMainOptionsTestSuite } from './run-if-main-options.test.ts';
import { testSuite as runIfMainSelectionTestSuite } from './run-if-main-selection.test.ts';
import { testSuite as runIfMainTestSuite } from './run-if-main.test.ts';

export const testSuite = createOverkillSuite({
    title: 'source/run/run-if-main-suite.test.ts',
    metadata: {},
    children: [
        runIfMainOptionsTestSuite,
        runIfMainSelectionTestSuite,
        runIfMainTestSuite
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testSuite);

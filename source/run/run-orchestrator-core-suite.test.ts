import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testSuite as runSelectionTestSuite } from './run-selection.test.ts';
import { testSuite as runTestSuite } from './run.test.ts';

export const testSuite = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/run/run-orchestrator-core-suite.test.ts',
    metadata: {},
    children: [
        runSelectionTestSuite,
        runTestSuite
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testSuite);

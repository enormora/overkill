import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as runRuntimeSelectionTestNode } from './run-runtime-selection.test.ts';
import { testNode as runSelectionFiltersTestNode } from './run-selection-filters.test.ts';

export const testNode = createSuite({
    annotations: {},
    children: [ runSelectionFiltersTestNode, runRuntimeSelectionTestNode ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/run-selection-suite.test.ts'
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

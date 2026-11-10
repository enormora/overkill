import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as debugRequests } from './run-debug.test.ts';
import { testNode as lastFailedResolutionTestNode } from './last-failed-resolution.test.ts';
import { testNode as lastFailedSelectionTestNode } from './last-failed-selection.test.ts';
import { testNode as runRuntimeSelectionTestNode } from './run-runtime-selection.test.ts';
import { testNode as runSelectionFiltersTestNode } from './run-selection-filters.test.ts';

export const testNode = createSuite({
    annotations: {},
    children: [
        debugRequests,
        lastFailedResolutionTestNode,
        lastFailedSelectionTestNode,
        runSelectionFiltersTestNode,
        runRuntimeSelectionTestNode
    ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/run-selection-suite.test.ts'
});

await runIfMain(import.meta, testNode);

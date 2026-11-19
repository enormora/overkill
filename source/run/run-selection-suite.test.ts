import { suite } from '@overkill-dev/test';

import { testNode as debugRequests } from './run-debug.test.ts';
import { testNode as lastFailedSelectionTestNode } from './last-failed-selection.test.ts';
import { testNode as runRuntimeSelectionTestNode } from './run-runtime-selection.test.ts';
import { testNode as runSelectionFiltersTestNode } from './run-selection-filters.test.ts';

export const testNode = suite('source/run/run-selection-suite.test.ts', [
    debugRequests,
    lastFailedSelectionTestNode,
    runSelectionFiltersTestNode,
    runRuntimeSelectionTestNode
]);

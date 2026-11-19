import { suite } from '@overkill-dev/test';

import { testNode as commandLineMergeResultsTestNode } from '../../../packages/test/command-line-merge-results.test.ts';
import { testNode as mergedRecordSessionTestNode } from '../../../run/merged-record-session.test.ts';
import { testNode as mergeResultsIncompleteTestNode } from '../../../run/merge-results-incomplete.test.ts';
import { testNode as mergeResultsTestNode } from '../../../run/merge-results.test.ts';

export const testNode = suite('persistence merges integration', [
    commandLineMergeResultsTestNode,
    mergedRecordSessionTestNode,
    mergeResultsIncompleteTestNode,
    mergeResultsTestNode
]);

import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as commandLineMergeResultsTestNode } from '../../../packages/test/command-line-merge-results.test.ts';
import { testNode as mergedRecordSessionTestNode } from '../../../run/merged-record-session.test.ts';
import { testNode as mergeResultsIncompleteTestNode } from '../../../run/merge-results-incomplete.test.ts';
import { testNode as mergeResultsTestNode } from '../../../run/merge-results.test.ts';

export const testNode = createSuite({
    title: 'persistence merges integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        commandLineMergeResultsTestNode,
        mergedRecordSessionTestNode,
        mergeResultsIncompleteTestNode,
        mergeResultsTestNode
    ]
});

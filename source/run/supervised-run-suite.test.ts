import { runIfMain } from '#test-runner';
import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as supervisedRunCollectionTestNode } from './supervised-run-collection.test.ts';
import { testNode as supervisedRunStateTestNode } from './supervised-run-state.test.ts';
import { testNode as retryAttributionTestNode } from './retry-attribution.test.ts';
import { testNode as cancellationOptionsTestNode } from './run-cancellation.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-run-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        cancellationOptionsTestNode,
        retryAttributionTestNode,
        supervisedRunCollectionTestNode,
        supervisedRunStateTestNode
    ]
});

await runIfMain(import.meta, testNode);

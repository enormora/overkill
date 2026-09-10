import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as comparisonCollectionsTestNode } from '../../compare/comparison-collections.test.ts';
import { testNode as comparisonEdgeTestNode } from '../../compare/comparison-edge.test.ts';
import { testNode as comparisonTestNode } from '../../compare/comparison.test.ts';
import { testNode as serializedValueEdgeTestNode } from '../../compare/serialized-value-edge.test.ts';
import { testNode as serializedValueTestNode } from '../../compare/serialized-value.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/test-support/unit-suite-groups/compare.ts',
    annotations: {},
    controls: {},
    children: [
        comparisonCollectionsTestNode,
        comparisonEdgeTestNode,
        comparisonTestNode,
        serializedValueEdgeTestNode,
        serializedValueTestNode
    ]
});

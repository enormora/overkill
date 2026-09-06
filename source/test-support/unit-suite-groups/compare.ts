import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testSuite as comparisonCollectionsTestSuite } from '../../compare/comparison-collections.test.ts';
import { testSuite as comparisonEdgeTestSuite } from '../../compare/comparison-edge.test.ts';
import { testSuite as comparisonTestSuite } from '../../compare/comparison.test.ts';
import { testSuite as serializedValueEdgeTestSuite } from '../../compare/serialized-value-edge.test.ts';
import { testSuite as serializedValueTestSuite } from '../../compare/serialized-value.test.ts';

export const testSuite = createSuite({
    title: 'source/test-support/unit-suite-groups/compare.ts',
    metadata: {},
    children: [
        comparisonCollectionsTestSuite,
        comparisonEdgeTestSuite,
        comparisonTestSuite,
        serializedValueEdgeTestSuite,
        serializedValueTestSuite
    ]
});

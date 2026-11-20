import { suite } from '@overkill-dev/test';

import { testNode as comparisonCollectionsTestNode } from '../../compare/comparison-collections.test.ts';
import { testNode as comparisonEdgeTestNode } from '../../compare/comparison-edge.test.ts';
import { testNode as comparisonTestNode } from '../../compare/comparison.test.ts';
import { testNode as serializedValueEdgeTestNode } from '../../compare/serialized-value-edge.test.ts';
import { testNode as serializedValueTestNode } from '../../compare/serialized-value.test.ts';

export const testNode = suite('source/test-support/unit-suite-groups/compare.ts', [
    comparisonCollectionsTestNode,
    comparisonEdgeTestNode,
    comparisonTestNode,
    serializedValueEdgeTestNode,
    serializedValueTestNode
]);

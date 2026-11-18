import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as benchEngineCopiesTestNode } from '../../../packages/bench/bench-engine-copies.test.ts';

import { testNode as runtimeHealthBoundaryTestNode } from '../../../bench/runtime-health-boundary.test.ts';
import { testNode as benchmarkStrategyContractsTestNode } from '../../../bench/benchmark-strategy-contracts.test.ts';
import { testNode as benchmarkGarbageCollectionTestNode } from '../../../bench/benchmark-garbage-collection.test.ts';

export const testNode = createSuite({
    title: 'benchmarks execution integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        benchEngineCopiesTestNode,

        runtimeHealthBoundaryTestNode,
        benchmarkStrategyContractsTestNode,
        benchmarkGarbageCollectionTestNode
    ]
});

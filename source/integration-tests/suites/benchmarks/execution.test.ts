import { suite } from '@overkill-dev/test';

import { testNode as benchEngineCopiesTestNode } from '../../../packages/bench/bench-engine-copies.test.ts';

import { testNode as runtimeHealthBoundaryTestNode } from '../../../bench/runtime-health-boundary.test.ts';
import { testNode as benchmarkStrategyContractsTestNode } from '../../../bench/benchmark-strategy-contracts.test.ts';
import { testNode as benchmarkGarbageCollectionTestNode } from '../../../bench/benchmark-garbage-collection.test.ts';

export const testNode = suite('benchmarks execution integration', [
    benchEngineCopiesTestNode,

    runtimeHealthBoundaryTestNode,
    benchmarkStrategyContractsTestNode,
    benchmarkGarbageCollectionTestNode
]);

import { suite } from '@overkill-dev/test';

import { testNode as runnerBenchmarkNormalizationTestNode } from '../../run/runner-benchmark-normalization.test.ts';
import { testNode as automaticNormalizationTestNode } from '../../../bench/automatic-normalization.test.ts';

export const testNode = suite('benchmarks normalization integration', [
    runnerBenchmarkNormalizationTestNode,
    automaticNormalizationTestNode
]);

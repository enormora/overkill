import { suite } from '@overkill-dev/test';

import { testNode as runnerBenchmarkBaselinesTestNode } from '../../run/runner-benchmark-baselines.test.ts';
import { testNode as runnerBenchmarkBaselineFailuresTestNode } from '../../run/runner-benchmark-baseline-failures.test.ts';
import { testNode as runnerBenchmarkBaselineCliTestNode } from '../../run/runner-benchmark-baseline-cli.test.ts';
import { testNode as calibrationStoreTestNode } from '../../../baselines/calibration-store.test.ts';
import { testNode as performanceStoreTestNode } from '../../../baselines/performance-store.test.ts';

export const testNode = suite('benchmarks baselines integration', [
    runnerBenchmarkBaselinesTestNode,
    runnerBenchmarkBaselineFailuresTestNode,
    runnerBenchmarkBaselineCliTestNode,
    calibrationStoreTestNode,
    performanceStoreTestNode
]);

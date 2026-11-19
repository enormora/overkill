import { suite } from '@overkill-dev/test';

import { testNode as runnerBenchmarksTestNode } from '../../run/runner-benchmarks.test.ts';
import { testNode as runnerBenchmarkHtmlTestNode } from '../../run/runner-benchmark-html.test.ts';
import { testNode as runnerBenchmarkPlacementTestNode } from '../../run/runner-benchmark-placement.test.ts';

export const testNode = suite('benchmarks runner integration', [
    runnerBenchmarksTestNode,
    runnerBenchmarkHtmlTestNode,
    runnerBenchmarkPlacementTestNode
]);

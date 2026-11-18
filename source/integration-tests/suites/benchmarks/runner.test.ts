import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as runnerBenchmarksTestNode } from '../../run/runner-benchmarks.test.ts';
import { testNode as runnerBenchmarkHtmlTestNode } from '../../run/runner-benchmark-html.test.ts';
import { testNode as runnerBenchmarkPlacementTestNode } from '../../run/runner-benchmark-placement.test.ts';

export const testNode = createSuite({
    title: 'benchmarks runner integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ runnerBenchmarksTestNode, runnerBenchmarkHtmlTestNode, runnerBenchmarkPlacementTestNode ]
});

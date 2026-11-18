import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as runnerBenchmarkNormalizationTestNode } from '../../run/runner-benchmark-normalization.test.ts';
import { testNode as automaticNormalizationTestNode } from '../../../bench/automatic-normalization.test.ts';

export const testNode = createSuite({
    title: 'benchmarks normalization integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ runnerBenchmarkNormalizationTestNode, automaticNormalizationTestNode ]
});

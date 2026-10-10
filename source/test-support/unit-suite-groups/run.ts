import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as baselineTestNode } from '../../run/benchmark-baseline-suite.test.ts';
import { testNode as runTestNode } from '../../run/run-suite.test.ts';
import { testNode as mutationTestNode } from '../../packages/stryker-runner/stryker-runner.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'runner and integrations',
    annotations: {},
    controls: {},
    children: [ runTestNode, mutationTestNode, baselineTestNode ]
});

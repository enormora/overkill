import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as baselinesTestNode } from './benchmarks/baselines.test.ts';
import { testNode as commandsTestNode } from './benchmarks/commands.test.ts';
import { testNode as executionTestNode } from './benchmarks/execution.test.ts';
import { testNode as normalizationTestNode } from './benchmarks/normalization.test.ts';
import { testNode as processTestNode } from './benchmarks/process.test.ts';
import { testNode as runnerTestNode } from './benchmarks/runner.test.ts';

export const testNode = createSuite({
    title: 'benchmarks integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        baselinesTestNode,
        commandsTestNode,
        executionTestNode,
        normalizationTestNode,
        processTestNode,
        runnerTestNode
    ]
});

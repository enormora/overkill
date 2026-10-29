import { testNode as diagnosticTestNode } from '../../packages/stryker-runner/mutation-diagnostic-persistence.test.ts';
import { testNode as observationTestNode } from '../../run/execution-session-observation.test.ts';
import { testNode as historyTestNode } from '../../run/history-suite.test.ts';
import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as baselineTestNode } from '../../run/benchmark-baseline-suite.test.ts';
import { testNode as runTestNode } from '../../run/run-suite.test.ts';
import { testNode as mutationTestNode } from '../../packages/stryker-runner/stryker-runner.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'runner and integrations',
    annotations: {},
    controls: {},
    children: [
        historyTestNode,
        runTestNode,
        mutationTestNode,
        diagnosticTestNode,
        observationTestNode,
        baselineTestNode
    ]
});

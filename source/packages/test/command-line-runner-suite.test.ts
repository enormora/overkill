import { createSuite } from '../engine/engine.entry-point.ts';
import { testNode as commandLineRunnerCaptureTestNode } from './command-line-runner-capture.test.ts';
import { testNode as commandLineRunnerCoverageTestNode } from './command-line-runner-coverage.test.ts';
import { testNode as commandLineRunnerNamespaceTestNode } from './command-line-runner-namespace-suite.test.ts';
import { testNode as commandLineRunnerOrderingTestNode } from './command-line-runner-ordering.test.ts';
import { testNode as commandLineRunnerSelectionTestNode } from './command-line-runner-selection-suite.test.ts';
import { testNode as commandLineRunnerShardingTestNode } from './command-line-runner-sharding.test.ts';
import { testNode as commandLineRunnerTimingsTestNode } from './command-line-runner-timings.test.ts';
import { testNode as commandLineRunnerWorkersTestNode } from './command-line-runner-workers.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/command-line-runner-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        commandLineRunnerCaptureTestNode,
        commandLineRunnerCoverageTestNode,
        commandLineRunnerNamespaceTestNode,
        commandLineRunnerOrderingTestNode,
        commandLineRunnerSelectionTestNode,
        commandLineRunnerShardingTestNode,
        commandLineRunnerTimingsTestNode,
        commandLineRunnerWorkersTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

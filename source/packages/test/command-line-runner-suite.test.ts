import { createSuite } from '../engine/engine.entry-point.ts';
import { testNode as commandLineRunnerCaptureTestNode } from './command-line-runner-capture.test.ts';
import { testNode as commandLineRunnerHelpTestNode } from './command-line-runner-help.test.ts';
import { testNode as commandLineRunnerOrderingTestNode } from './command-line-runner-ordering.test.ts';
import { testNode as commandLineRunnerShardingTestNode } from './command-line-runner-sharding.test.ts';
import { testNode as commandLineRunnerTimingsTestNode } from './command-line-runner-timings.test.ts';
import { testNode as commandLineRunnerTestNode } from './command-line-runner.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/command-line-runner-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        commandLineRunnerCaptureTestNode,
        commandLineRunnerHelpTestNode,
        commandLineRunnerOrderingTestNode,
        commandLineRunnerShardingTestNode,
        commandLineRunnerTimingsTestNode,
        commandLineRunnerTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

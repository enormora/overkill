import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as workerPoolExecutionStateTestNode } from './worker-pool-execution-state.test.ts';
import { testNode as workerPoolResultsTestNode } from './worker-pool-results.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-execution-suite.test.ts',
    children: [
        workerPoolExecutionStateTestNode,
        workerPoolResultsTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

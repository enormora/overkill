import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as supervisedRunTestNode } from './supervised-run-suite.test.ts';
import { testNode as workerPoolExecutionStateTestNode } from './worker-pool-execution-state.test.ts';
import { testNode as workerPoolPlanningTestNode } from './worker-pool-planning.test.ts';
import { testNode as workerPoolRunTestNode } from './worker-pool-run.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-execution-suite.test.ts',
    children: [
        supervisedRunTestNode,
        workerPoolExecutionStateTestNode,
        workerPoolPlanningTestNode,
        workerPoolRunTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

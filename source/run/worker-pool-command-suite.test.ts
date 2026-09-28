import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as workerPoolCommandPlanningTestNode } from './worker-pool-command-planning.test.ts';
import { testNode as workerPoolCommandTestNode } from './worker-pool-command.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-command-suite.test.ts',
    children: [
        workerPoolCommandPlanningTestNode,
        workerPoolCommandTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

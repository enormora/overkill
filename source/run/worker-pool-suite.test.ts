import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as workerPoolCoreTestNode } from './worker-pool-core-suite.test.ts';
import { testNode as workerPoolHostTestNode } from './worker-pool-host-suite.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-suite.test.ts',
    children: [
        workerPoolCoreTestNode,
        workerPoolHostTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

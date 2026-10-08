import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as childProcessOutboxTestNode } from './child-process-outbox.test.ts';
import { testNode as attachments } from './runtime-attachment-suite.test.ts';
import { testNode as durationHistoryTestNode } from './duration-history.test.ts';
import { testNode as supervisedRunTestNode } from './supervised-run-suite.test.ts';
import { testNode as workerPoolTestNode } from './worker-pool-suite.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-execution-suite.test.ts',
    children: [
        attachments,
        childProcessOutboxTestNode,
        durationHistoryTestNode,
        supervisedRunTestNode,
        workerPoolTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

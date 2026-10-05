import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as attachmentRetention } from './runtime-attachment-retention.test.ts';
import { testNode as attachmentResults } from './runtime-attachment-results.test.ts';
import { testNode as attachmentWorker } from './runtime-attachment-worker.test.ts';
import { testNode as attachments } from './runtime-attachments.test.ts';
import { testNode as attachmentOwnership } from './runtime-attachment-ownership.test.ts';
import { testNode as durationHistoryTestNode } from './duration-history.test.ts';
import { testNode as supervisedRunTestNode } from './supervised-run-suite.test.ts';
import { testNode as workerPoolTestNode } from './worker-pool-suite.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-execution-suite.test.ts',
    children: [
        attachmentWorker,
        attachmentResults,
        attachmentRetention,
        attachments,
        attachmentOwnership,
        durationHistoryTestNode,
        supervisedRunTestNode,
        workerPoolTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

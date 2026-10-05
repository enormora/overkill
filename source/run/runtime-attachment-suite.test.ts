import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as retention } from './runtime-attachment-retention.test.ts';
import { testNode as results } from './runtime-attachment-results.test.ts';
import { testNode as worker } from './runtime-attachment-worker.test.ts';
import { testNode as validation } from './runtime-attachment-validation.test.ts';
import { testNode as protocol } from './runtime-attachment-protocol.test.ts';
import { testNode as attachments } from './runtime-attachments.test.ts';
import { testNode as ownership } from './runtime-attachment-ownership.test.ts';
import { testNode as failure } from './runtime-attachment-failure.test.ts';

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'runtime attachments',
    children: [ retention, results, worker, validation, protocol, attachments, ownership, failure ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);

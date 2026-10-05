import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as attachmentRecordTestNode } from './runtime-attachment-record.test.ts';
import { testNode as resultTestNode } from './run-record-result.test.ts';
import { testNode as versionsTestNode } from './run-record-versions.test.ts';
import { testNode as recordTestNode } from './run-record.test.ts';
import { testNode as storageTestNode } from './node-runtime-state-store.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/run-record-suite.test.ts',
    annotations: {},
    controls: {},
    children: [ attachmentRecordTestNode, resultTestNode, versionsTestNode, recordTestNode, storageTestNode ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);

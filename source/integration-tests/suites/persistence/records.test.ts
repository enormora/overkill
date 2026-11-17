import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as runtimeAttachmentRecordTestNode } from '../../../run/runtime-attachment-record.test.ts';
import { testNode as runRecordVersionsTestNode } from '../../../run/run-record-versions.test.ts';
import { testNode as nodeRuntimeStateStoreTestNode } from '../../../run/node-runtime-state-store.test.ts';
import { testNode as runRecordAttachmentsTestNode } from '../../../run/run-record-attachments.test.ts';
import { testNode as runnerFamilyRecordsTestNode } from '../../run/runner-family-records.test.ts';
import { testNode as runnerRecordPolicyTestNode } from '../../run/runner-record-policy.test.ts';

export const testNode = createSuite({
    title: 'persistence records integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        runtimeAttachmentRecordTestNode,
        runRecordVersionsTestNode,
        nodeRuntimeStateStoreTestNode,
        runRecordAttachmentsTestNode,
        runnerFamilyRecordsTestNode,
        runnerRecordPolicyTestNode
    ]
});

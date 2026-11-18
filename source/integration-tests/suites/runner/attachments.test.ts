import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as runtimeAttachmentSessionTestNode } from '../../../run/runtime-attachment-session.test.ts';
import { testNode as runtimeAttachmentStorageTestNode } from '../../../run/runtime-attachment-storage.test.ts';
import { testNode as runtimeAttachmentContentTestNode } from '../../../run/runtime-attachment-content.test.ts';
import { testNode as childProcessAttachmentSchemaTestNode } from '../../../run/child-process-attachment-schema.test.ts';
import { testNode as runtimeAttachmentSuiteTestNode } from '../../../run/runtime-attachment-suite.test.ts';
import { testNode as runnerAttachmentsTestNode } from '../../run/runner-attachments.test.ts';
import { testNode as runnerAttachmentRetentionTestNode } from '../../run/runner-attachment-retention.test.ts';

export const testNode = createSuite({
    title: 'runner attachments integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        runtimeAttachmentSessionTestNode,
        runtimeAttachmentStorageTestNode,
        runtimeAttachmentContentTestNode,
        childProcessAttachmentSchemaTestNode,
        runtimeAttachmentSuiteTestNode,
        runnerAttachmentsTestNode,
        runnerAttachmentRetentionTestNode
    ]
});

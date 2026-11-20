import { suite } from '@overkill-dev/test';

import { testNode as runConfigAttachmentsTestNode } from './config-attachments.test.ts';
import { testNode as coverageConfigSchemaTestNode } from './coverage-schema.test.ts';
import { testNode as runConfigSchemaTimingsTestNode } from './config-schema-timings.test.ts';
import { testNode as runConfigSchemaTestNode } from './config-schema.test.ts';
import { testNode as runConfigWorkerCapacitySchemaTestNode } from './config-worker-capacity-schema.test.ts';

export const testNode = suite('source/config/config-schema-suite.test.ts', [
    coverageConfigSchemaTestNode,
    runConfigAttachmentsTestNode,
    runConfigSchemaTimingsTestNode,
    runConfigSchemaTestNode,
    runConfigWorkerCapacitySchemaTestNode
]);

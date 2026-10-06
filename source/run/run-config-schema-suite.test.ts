import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as runConfigAttachmentsTestNode } from './run-config-attachments.test.ts';
import { testNode as coverageConfigSchemaTestNode } from './coverage-config-schema.test.ts';
import { testNode as runConfigSchemaTimingsTestNode } from './run-config-schema-timings.test.ts';
import { testNode as runConfigSchemaTestNode } from './run-config-schema.test.ts';
import { testNode as runConfigWorkerCapacitySchemaTestNode } from './run-config-worker-capacity-schema.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-config-schema-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        coverageConfigSchemaTestNode,
        runConfigAttachmentsTestNode,
        runConfigSchemaTimingsTestNode,
        runConfigSchemaTestNode,
        runConfigWorkerCapacitySchemaTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

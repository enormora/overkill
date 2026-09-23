import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as runConfigSchemaTimingsTestNode } from './run-config-schema-timings.test.ts';
import { testNode as runConfigSchemaTestNode } from './run-config-schema.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-config-schema-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        runConfigSchemaTimingsTestNode,
        runConfigSchemaTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

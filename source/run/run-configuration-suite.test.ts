import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as runConfigExportsTestNode } from './run-config-exports.test.ts';
import { testNode as runConfigLoadErrorTestNode } from './run-config-load-error.test.ts';
import { testNode as runConfigProfileFilesTestNode } from './run-config-profile-files.test.ts';
import { testNode as runConfigReportersTestNode } from './run-config-reporters.test.ts';
import { testNode as runConfigSchemaTestNode } from './run-config-schema.test.ts';
import { testNode as runConfigTestNode } from './run-config.test.ts';
import { testNode as runProfileNameTestNode } from './run-profile-name.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-configuration-suite.test.ts',
    metadata: {},
    children: [
        runConfigExportsTestNode,
        runConfigLoadErrorTestNode,
        runConfigProfileFilesTestNode,
        runConfigReportersTestNode,
        runConfigSchemaTestNode,
        runConfigTestNode,
        runProfileNameTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

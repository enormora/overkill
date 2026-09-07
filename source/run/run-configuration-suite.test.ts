import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testSuite as runConfigExportsTestSuite } from './run-config-exports.test.ts';
import { testSuite as runConfigLoadErrorTestSuite } from './run-config-load-error.test.ts';
import { testSuite as runConfigProfileFilesTestSuite } from './run-config-profile-files.test.ts';
import { testSuite as runConfigReportersTestSuite } from './run-config-reporters.test.ts';
import { testSuite as runConfigSchemaTestSuite } from './run-config-schema.test.ts';
import { testSuite as runConfigTestSuite } from './run-config.test.ts';
import { testSuite as runProfileNameTestSuite } from './run-profile-name.test.ts';

export const testSuite = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/run/run-configuration-suite.test.ts',
    metadata: {},
    children: [
        runConfigExportsTestSuite,
        runConfigLoadErrorTestSuite,
        runConfigProfileFilesTestSuite,
        runConfigReportersTestSuite,
        runConfigSchemaTestSuite,
        runConfigTestSuite,
        runProfileNameTestSuite
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testSuite);

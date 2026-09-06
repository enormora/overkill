import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import { createSuite as createOverkillSuite, runIfMain } from '../packages/engine/engine.entry-point.ts';
import { testSuite as runConfigExportsTestSuite } from './run-config-exports.test.ts';
import { testSuite as runConfigProfileFilesTestSuite } from './run-config-profile-files.test.ts';
import { testSuite as runConfigReportersTestSuite } from './run-config-reporters.test.ts';
import { testSuite as runConfigSchemaTestSuite } from './run-config-schema.test.ts';
import { testSuite as runConfigTestSuite } from './run-config.test.ts';
import { testSuite as runProfileNameTestSuite } from './run-profile-name.test.ts';

export const testSuite = createOverkillSuite({
    title: 'source/run/run-configuration-suite.test.ts',
    metadata: {},
    children: [
        runConfigExportsTestSuite,
        runConfigProfileFilesTestSuite,
        runConfigReportersTestSuite,
        runConfigSchemaTestSuite,
        runConfigTestSuite,
        runProfileNameTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });

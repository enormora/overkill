import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import { createSuite as createOverkillSuite, runIfMain } from '@overkill-dev/engine';
import { testSuite as runConfigExportsTestSuite } from './run-config-exports.test.ts';
import { testSuite as runConfigReportersTestSuite } from './run-config-reporters.test.ts';
import { testSuite as runConfigSchemaTestSuite } from './run-config-schema.test.ts';
import { testSuite as runConfigTestSuite } from './run-config.test.ts';
import { testSuite as runProfileNameTestSuite } from './run-profile-name.test.ts';

export const testSuite = createOverkillSuite({
    name: 'source/run/run-configuration-suite.test.ts',
    metadata: {},
    children: [
        runConfigExportsTestSuite,
        runConfigReportersTestSuite,
        runConfigSchemaTestSuite,
        runConfigTestSuite,
        runProfileNameTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });

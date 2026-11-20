import { suite } from '@overkill-dev/test';

import { testNode as runConfigCoreTestNode } from '../config/config-core-suite.test.ts';
import { testNode as runConfigExportsTestNode } from '../config/config-exports.test.ts';
import { testNode as runConfigLoadErrorTestNode } from '../config/config-load-error.test.ts';
import { testNode as runConfigProfileFilesTestNode } from '../config/config-profile-files.test.ts';
import { testNode as runConfigReportersTestNode } from '../config/config-reporters.test.ts';
import { testNode as runConfigSchemaSuiteTestNode } from '../config/config-schema-suite.test.ts';
import { testNode as runHostProcessTestNode } from './run-host-process.test.ts';
import { testNode as runProfileNameTestNode } from './run-profile-name.test.ts';

export const testNode = suite('source/run/run-configuration-suite.test.ts', [
    runConfigCoreTestNode,
    runConfigExportsTestNode,
    runConfigLoadErrorTestNode,
    runConfigProfileFilesTestNode,
    runConfigReportersTestNode,
    runConfigSchemaSuiteTestNode,
    runHostProcessTestNode,
    runProfileNameTestNode
]);

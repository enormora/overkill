import { suite } from '@overkill-dev/test';

import { testNode as hostTestNode } from './benchmark-host.test.ts';
import { testNode as benchmarkProfileTestNode } from './benchmark-profile.test.ts';
import { testNode as runConfigIntegrationProfileTestNode } from './config-integration-profile.test.ts';
import { testNode as runConfigTestNode } from './config.test.ts';
import { testNode as runConfigTimeoutsTestNode } from './config-timeouts.test.ts';
import { testNode as runConfigRetriesTestNode } from './config-retries.test.ts';
import { testNode as adapterProfileTestNode } from './config-adapter-profile.test.ts';

export const testNode = suite('source/config/config-core-suite.test.ts', [
    adapterProfileTestNode,
    benchmarkProfileTestNode,
    hostTestNode,
    runConfigRetriesTestNode,
    runConfigTestNode,
    runConfigIntegrationProfileTestNode,
    runConfigTimeoutsTestNode
]);

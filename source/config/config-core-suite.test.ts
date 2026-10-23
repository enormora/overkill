import { runIfMain } from '#test-runner';
import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as hostTestNode } from './benchmark-host.test.ts';
import { testNode as benchmarkProfileTestNode } from './benchmark-profile.test.ts';
import { testNode as runConfigIntegrationProfileTestNode } from './config-integration-profile.test.ts';
import { testNode as runConfigTestNode } from './config.test.ts';
import { testNode as runConfigTimeoutsTestNode } from './config-timeouts.test.ts';
import { testNode as runConfigRetriesTestNode } from './config-retries.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/config/config-core-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        benchmarkProfileTestNode,
        hostTestNode,
        runConfigRetriesTestNode,
        runConfigTestNode,
        runConfigIntegrationProfileTestNode,
        runConfigTimeoutsTestNode
    ]
});

await runIfMain(import.meta, testNode);

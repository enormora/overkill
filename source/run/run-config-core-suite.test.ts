import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as runConfigIntegrationProfileTestNode } from './run-config-integration-profile.test.ts';
import { testNode as runConfigTestNode } from './run-config.test.ts';
import { testNode as runConfigTimeoutsTestNode } from './run-config-timeouts.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-config-core-suite.test.ts',
    metadata: {},
    children: [
        runConfigTestNode,
        runConfigIntegrationProfileTestNode,
        runConfigTimeoutsTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

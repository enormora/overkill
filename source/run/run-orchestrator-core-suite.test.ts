import { runIfMain } from '#test-runner';
import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as coverageTestNode } from './coverage-suite.test.ts';
import { testNode as runEmptyShardTestNode } from './run-empty-shard.test.ts';
import { testNode as runProfilePolicyTestNode } from './run-profile-policy.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-orchestrator-core-suite.test.ts',
    annotations: {},
    controls: {},
    children: [ coverageTestNode, runEmptyShardTestNode, runProfilePolicyTestNode ]
});

await runIfMain(import.meta, testNode);

import { suite } from '@overkill-dev/test';

import { testNode as coverageTestNode } from './coverage-suite.test.ts';
import { testNode as runEmptyShardTestNode } from './run-empty-shard.test.ts';
import { testNode as runProfilePolicyTestNode } from './run-profile-policy.test.ts';

export const testNode = suite('source/run/run-orchestrator-core-suite.test.ts', [
    coverageTestNode,
    runEmptyShardTestNode,
    runProfilePolicyTestNode
]);

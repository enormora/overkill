import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as runEmptyShardTestNode } from './run-empty-shard.test.ts';
import { testNode as runOrderingTestNode } from './run-ordering.test.ts';
import { testNode as runProfilePolicyTestNode } from './run-profile-policy.test.ts';
import { testNode as runSelectionTestNode } from './run-selection.test.ts';
import { testNode as runTestNode } from './run.test.ts';
import { testNode as runValidationTestNode } from './run-validation.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-orchestrator-core-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        runEmptyShardTestNode,
        runOrderingTestNode,
        runProfilePolicyTestNode,
        runSelectionTestNode,
        runTestNode,
        runValidationTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

import { runIfMain } from '#test-runner';
import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as snapshotTestNode } from './capability-policy-snapshots.test.ts';
import { testNode as runtimePolicyTestNode } from './run-runtime-policy.test.ts';

export const testNode = suite('runtime policy', [ snapshotTestNode, runtimePolicyTestNode ]);

await runIfMain(import.meta, testNode);

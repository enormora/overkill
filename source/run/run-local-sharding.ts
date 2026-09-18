import { workIdentityKey } from '../engine/identity.ts';
import type { TestPlan, TestPlanCase } from '../engine/test-plan.ts';
import {
    collectedRunCaseEntries,
    collectedRunPlanFromTestPlanCases
} from './collected-run-plan.ts';
import type { ResolvedRunInput } from './run-input-resolution.ts';
import {
    createRunShardHasher,
    shardCollectedRunCaseEntries
} from './run-sharding.ts';

export async function shardedLocalCases(
    testPlan: TestPlan,
    input: ResolvedRunInput
): Promise<readonly TestPlanCase[]> {
    const shardHasher = await createRunShardHasher(input.request.shard);
    const entries = shardCollectedRunCaseEntries(
        collectedRunCaseEntries(collectedRunPlanFromTestPlanCases(testPlan, testPlan.cases)),
        input.request.shard,
        shardHasher
    );
    const casesByKey = new Map(testPlan.cases.map(function toCaseEntry(testCase) {
        return [ workIdentityKey(testCase.workId), testCase ];
    }));

    return entries.flatMap(function toTestCase(entry) {
        const testCase = casesByKey.get(workIdentityKey(entry.workId));

        return testCase === undefined ? [] : [ testCase ];
    });
}

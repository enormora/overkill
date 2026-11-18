import { planCollectedExecution } from '../run/run-collected-planning.ts';
import type { RunShardHasher } from '../run/run-sharding.ts';
import type { CollectedExecutionPlanInput } from '../run/collected-placement.ts';

const initialHash = 0n;
const hasher: RunShardHasher = {
    hash(value) {
        return Array.from(value).reduce(function (sum, character) {
            return sum + BigInt(character.codePointAt(0) ?? 0);
        }, initialHash);
    }
};
export async function collectedPlanning(input: CollectedExecutionPlanInput): ReturnType<typeof planCollectedExecution> {
    return await planCollectedExecution(input, async function (shard) {
        return shard.total === 1 ? null : hasher;
    });
}

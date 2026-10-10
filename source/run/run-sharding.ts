import { canonicalIdentityJson } from '../canonical-identity.ts';
import {
    type CollectedRunCaseEntry,
    collectedRunCaseEntries
} from './collected-run-plan.ts';
import type {
    CollectedRunPlan,
    RunShard,
    WorkUnitId
} from './run-types.ts';
import { caseWorkUnitId } from './work-unit-identity.ts';

export type RunShardHasher = {
    readonly hash: (value: string) => bigint;
};

type ShardHashState = {
    readonly digest: (outputType: 'hex') => string;
    readonly init: () => ShardHashState;
    readonly update: (value: string) => ShardHashState;
};

type ShardHashModule = {
    readonly createXXHash3: (seedLow?: number, seedHigh?: number) => Promise<ShardHashState>;
};

function isShardHashModule(value: unknown): value is ShardHashModule {
    return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'createXXHash3') === 'function';
}

function shardIndex(shard: RunShard): bigint {
    return BigInt(shard.index - 1);
}

function shardTotal(shard: RunShard): bigint {
    return BigInt(shard.total);
}

export async function createRunShardHasher(shard: RunShard): Promise<RunShardHasher | null> {
    if (shard.total === 1) {
        return null;
    }

    const hashModule: unknown = await import('hash-wasm');

    if (!isShardHashModule(hashModule)) {
        throw new TypeError('hash-wasm did not provide createXXHash3().');
    }

    const hasher = await hashModule.createXXHash3(0, 0);

    return {
        hash(value) {
            hasher.init();
            hasher.update(value);

            return BigInt(`0x${hasher.digest('hex')}`);
        }
    };
}

export function workUnitBelongsToShard(
    unit: WorkUnitId,
    shard: RunShard,
    hasher: RunShardHasher | null
): boolean {
    if (shard.total === 1) {
        return true;
    }

    if (hasher === null) {
        throw new Error('Sharded planning requires a shard hasher.');
    }

    return hasher.hash(canonicalIdentityJson(unit)) % shardTotal(shard) === shardIndex(shard);
}

export function shardCollectedRunCaseEntries(
    entries: readonly CollectedRunCaseEntry[],
    shard: RunShard,
    hasher: RunShardHasher | null
): readonly CollectedRunCaseEntry[] {
    return entries.filter(function caseBelongsToShard(entry) {
        return workUnitBelongsToShard(caseWorkUnitId(entry.workId), shard, hasher);
    });
}

export function shardCollectedRunPlanCases(
    plan: CollectedRunPlan,
    shard: RunShard,
    hasher: RunShardHasher | null
): readonly CollectedRunCaseEntry[] {
    return shardCollectedRunCaseEntries(collectedRunCaseEntries(plan), shard, hasher);
}

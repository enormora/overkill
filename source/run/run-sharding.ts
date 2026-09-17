import {
    type CollectedRunCaseEntry,
    collectedRunCaseEntries
} from './collected-run-plan.ts';
import type {
    CollectedRunPlan,
    RunShard,
    RunShardHashAlgorithm,
    WorkUnitId
} from './run-types.ts';
import { caseWorkUnitId } from './work-unit-identity.ts';

type CanonicalJsonValue = boolean | null | number | string | readonly CanonicalJsonValue[] | {
    readonly [key: string]: CanonicalJsonValue;
};

export type RunShardHasher = {
    readonly hash: (value: string) => bigint;
};

export const runShardHashAlgorithm: RunShardHashAlgorithm = 'xxh3-64-canonical-json-v1';

function sortedObjectKeys(value: object): readonly string[] {
    return Object.keys(value).toSorted(function compareKeys(left, right) {
        return left.localeCompare(right);
    });
}

function canonicalNumber(value: number): number {
    if (Number.isFinite(value)) {
        return value;
    }

    throw new TypeError('Cannot serialize number value for shard partitioning.');
}

function canonicalObject(value: object): CanonicalJsonValue {
    if (Array.isArray(value)) {
        return value.map(canonicalJsonValue);
    }

    return Object.fromEntries(
        sortedObjectKeys(value).map(function toCanonicalEntry(key) {
            return [ key.normalize('NFC'), canonicalJsonValue(Reflect.get(value, key)) ];
        })
    );
}

function canonicalJsonValue(value: unknown): CanonicalJsonValue {
    switch (typeof value) {
        case 'boolean':
            return value;
        case 'number':
            return canonicalNumber(value);
        case 'object':
            return value === null ? null : canonicalObject(value);
        case 'string':
            return value.normalize('NFC');
        default:
            throw new TypeError(`Cannot serialize ${typeof value} value for shard partitioning.`);
    }
}

function canonicalJson(value: WorkUnitId): string {
    return JSON.stringify(canonicalJsonValue(value));
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

    const { createXXHash3 } = await import('hash-wasm');
    const hasher = await createXXHash3(0, 0);

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

    return hasher.hash(canonicalJson(unit)) % shardTotal(shard) === shardIndex(shard);
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

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

type CanonicalJsonValue = boolean | number | string | readonly CanonicalJsonValue[] | {
    readonly [key: string]: CanonicalJsonValue;
} | null;

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

function sortedObjectKeys(value: Readonly<Record<string, unknown>>): readonly string[] {
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

function canonicalScalar(value: unknown): boolean | number | string | undefined {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return canonicalNumber(value);
    }

    if (typeof value === 'string') {
        return value.normalize('NFC');
    }

    return undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isShardHashModule(value: unknown): value is ShardHashModule {
    return isRecord(value) && typeof value.createXXHash3 === 'function';
}

function canonicalArray(
    value: readonly unknown[],
    canonicalize: (item: unknown) => CanonicalJsonValue
): readonly CanonicalJsonValue[] {
    return value.map(canonicalize);
}

function canonicalRecord(
    value: Readonly<Record<string, unknown>>,
    canonicalize: (item: unknown) => CanonicalJsonValue
): CanonicalJsonValue {
    return Object.fromEntries(
        sortedObjectKeys(value).map(function toCanonicalEntry(key) {
            return [ key.normalize('NFC'), canonicalize(value[key]) ];
        })
    );
}

function canonicalJsonValue(value: unknown): CanonicalJsonValue {
    const scalar = canonicalScalar(value);

    if (scalar !== undefined) {
        return scalar;
    }

    if (value === null) {
        return null;
    }

    if (Array.isArray(value)) {
        return canonicalArray(value, canonicalJsonValue);
    }

    if (isRecord(value)) {
        return canonicalRecord(value, canonicalJsonValue);
    }

    throw new TypeError(`Cannot serialize ${typeof value} value for shard partitioning.`);
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

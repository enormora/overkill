import type { BenchmarkGarbageCollectionPolicy, BenchmarkGarbageCollectionRequest } from './benchmark-result.ts';

export type BenchmarkGarbageCollectionCapability = {
    readonly kind: 'available';
    readonly collect: () => void;
} | {
    readonly kind: 'unavailable';
    readonly reason: string;
};

export type BenchmarkExecutionEnvironment = {
    readonly profileGarbageCollection: BenchmarkGarbageCollectionPolicy;
    readonly garbageCollection: BenchmarkGarbageCollectionCapability;
};

export function resolveBenchmarkGarbageCollection(
    request: BenchmarkGarbageCollectionRequest,
    profile: BenchmarkGarbageCollectionPolicy
): BenchmarkGarbageCollectionPolicy {
    return request === 'profile-default' ? profile : request;
}

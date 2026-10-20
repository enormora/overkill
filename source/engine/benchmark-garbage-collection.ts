import type { BenchmarkGarbageCollectionPolicy, BenchmarkGarbageCollectionRequest } from './benchmark-result.ts';

export type BenchmarkGarbageCollectionCapability = {
    readonly kind: 'available';
    readonly collect: () => void;
} | {
    readonly kind: 'unavailable';
    readonly reason: string;
};

export function resolveBenchmarkGarbageCollection(
    request: BenchmarkGarbageCollectionRequest,
    profile: BenchmarkGarbageCollectionPolicy
): BenchmarkGarbageCollectionPolicy {
    return request === 'profile-default' ? profile : request;
}

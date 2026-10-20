import type { BenchmarkGarbageCollectionPolicy, BenchmarkNormalizationContext } from './benchmark-result.ts';
import type { BenchmarkGarbageCollectionCapability } from './benchmark-garbage-collection.ts';

export type BenchmarkExecutionEnvironment = {
    readonly profileGarbageCollection: BenchmarkGarbageCollectionPolicy;
    readonly garbageCollection: BenchmarkGarbageCollectionCapability;
    readonly normalization: BenchmarkNormalizationContext | null;
};

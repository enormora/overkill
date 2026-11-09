import type { PerformanceBaselineAdapter } from './performance-adapter.ts';
import type { OrdinaryBaselineAdapter } from './ordinary-baseline-adapter.ts';

export type BenchmarkBaselinePolicy = {
    readonly adapters: readonly PerformanceBaselineAdapter[];
    readonly directory: string;
};
export type OrdinaryBaselinePolicy = {
    readonly adapters: readonly OrdinaryBaselineAdapter[];
    readonly directory: string;
    readonly snapshots: boolean;
    readonly stale: 'fail' | 'warn';
};

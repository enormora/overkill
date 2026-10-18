import type { ResolvableSourceLocations } from '../assertion-protocol/assertion-node-shape.ts';
import type { BenchmarkLifecyclePolicy, BenchmarkWorkload, SamplingPolicy } from '../engine/benchmark-result.ts';
import type { BenchmarkScope } from '../engine/test-node.ts';
import type { NormalizedMetricBudget } from './benchmark-budget-definition.ts';
import type { AsyncMeasurementStrategy, MeasurementStrategy } from './measurement-types.ts';

export type SamplingSessionInput = {
    readonly lifecycle: BenchmarkLifecyclePolicy;
    readonly body: (scope: never) => unknown;
    readonly context: Readonly<Record<string, unknown>>;
    readonly scope: BenchmarkScope;
    readonly workload: BenchmarkWorkload;
    readonly measurement: AsyncMeasurementStrategy | MeasurementStrategy;
    readonly budgets: readonly NormalizedMetricBudget[];
    readonly diagnostics: readonly string[];
    readonly policy: SamplingPolicy;
    readonly locations: ResolvableSourceLocations;
};

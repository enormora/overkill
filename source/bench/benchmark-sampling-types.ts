import type {
    BenchmarkNormalizationEvidence,
    ResolvedBenchmarkLifecyclePolicy,
    BenchmarkWorkload,
    SamplingPolicy
} from '../engine/benchmark-result.ts';
import type { ResolvableSourceLocations } from '../assertion-protocol/assertion-node-shape.ts';
import type { BenchmarkScope } from '../engine/test-node.ts';
import type { NormalizedMetricBudget } from './benchmark-budget-definition.ts';
import type { AsyncMeasurementStrategy, MeasurementStrategy } from './measurement-types.ts';
import type { ProcessMeasurementStrategy } from './process-measurement.ts';

export type SamplingSessionInput = {
    readonly normalization: BenchmarkNormalizationEvidence | null;
    readonly lifecycle: ResolvedBenchmarkLifecyclePolicy;
    readonly body: (scope: never) => unknown;
    readonly context: Readonly<Record<string, unknown>>;
    readonly scope: BenchmarkScope;
    readonly workload: BenchmarkWorkload;
    readonly measurement: AsyncMeasurementStrategy | MeasurementStrategy | ProcessMeasurementStrategy;
    readonly budgets: readonly NormalizedMetricBudget[];
    readonly diagnostics: readonly string[];
    readonly policy: SamplingPolicy;
    readonly locations: ResolvableSourceLocations;
};

import type {
    BenchmarkNormalizationEvidence,
    ResolvedBenchmarkLifecyclePolicy,
    BenchmarkWorkload,
    SamplingPolicy
} from '../engine/benchmark-result.ts';
import type { ResolvableSourceLocations } from '../assertion-protocol/assertion-node-shape.ts';
import type { BenchmarkScope } from '../engine/test-node.ts';
import type { UncalibratedMeasurement } from './measurement-definition.ts';
import type { NormalizedMetricBudget } from './benchmark-budget-definition.ts';

export type SamplingSessionInput = {
    readonly normalization: BenchmarkNormalizationEvidence | null;
    readonly lifecycle: ResolvedBenchmarkLifecyclePolicy;
    readonly body: (scope: never) => unknown;
    readonly context: Readonly<Record<string, unknown>>;
    readonly scope: BenchmarkScope;
    readonly workload: BenchmarkWorkload;
    readonly measurement: UncalibratedMeasurement;
    readonly budgets: readonly NormalizedMetricBudget[];
    readonly diagnostics: readonly string[];
    readonly policy: SamplingPolicy;
    readonly locations: ResolvableSourceLocations;
};

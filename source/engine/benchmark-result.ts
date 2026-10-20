import type { JsonValue, ReadonlyDeep } from 'type-fest';
import type { WorkloadParameters } from './workload-parameters.ts';
import type { WorkId, WorkloadId } from './identity.ts';

export const benchmarkLifecycleVersion = 2;

export type BenchmarkWorkload<Parameters extends WorkloadParameters = WorkloadParameters> = {
    readonly name: string;
    readonly parameters: Parameters;
};

export type BenchmarkDefinitionSummary = {
    readonly normalization: Readonly<
        Record<string, NormalizationRuleSummary>
    >;
    readonly lifecycle: BenchmarkLifecyclePolicy | null;
    readonly kind: string;
    readonly workloads: readonly BenchmarkWorkload[];
    readonly measurement: {
        readonly mode: 'async' | 'sync';
        readonly collectors: readonly {
            readonly name: string;
            readonly metrics: readonly (MetricProvenance & { readonly name: string; })[];
        }[];
    } | {
        readonly mode: 'process';
        readonly instrumentation: 'node' | 'off';
    };
    readonly diagnostics: readonly string[];
    readonly budgets: Readonly<
        Record<string, readonly Pick<BenchmarkBudgetResult, 'maximum' | 'metric' | 'minimum' | 'statistic'>[]>
    >;
    readonly policy: SamplingPolicy;
};

export type SamplingPolicy = {
    readonly confidenceLevel: number;
    readonly relativePrecision: number;
    readonly absolutePrecision: Readonly<Record<string, number>>;
    readonly minimumSamples: number;
    readonly maximumSamples: number;
};

type BudgetStatistics = {
    readonly mean: { readonly kind: 'mean'; readonly range: { readonly minimum: number; readonly maximum: number; }; };
    readonly observedMaximum: { readonly kind: 'observed-maximum'; };
    readonly observedMinimum: { readonly kind: 'observed-minimum'; };
    readonly quantile: { readonly kind: 'quantile'; readonly probability: number; };
};
export type BudgetStatistic = BudgetStatistics[keyof BudgetStatistics];

export type MetricProvenance = {
    readonly collector: string;
    readonly scope: 'custom' | 'process' | 'region' | 'runtime' | 'thread';
    readonly unit: string;
};

type MetricReadingStates = {
    readonly available: {
        readonly availability: 'available';
        readonly value: number;
        readonly provenance: MetricProvenance;
    };
    readonly unavailable: {
        readonly availability: 'unavailable';
        readonly reason: string;
        readonly provenance: MetricProvenance;
    };
};
export type MetricReading = MetricReadingStates[keyof MetricReadingStates];

export type BenchmarkBudgetResult = {
    readonly metric: string;
    readonly statistic: BudgetStatistic;
    readonly minimum: number | null;
    readonly maximum: number | null;
    readonly estimate: number | null;
    readonly interval: { readonly lower: number | null; readonly upper: number | null; };
    readonly precise: boolean;
    readonly decision: 'fail' | 'pass' | 'unavailable' | 'undecided';
};

export type BenchmarkMetricSummary = {
    readonly count: number;
    readonly minimum: number | null;
    readonly maximum: number | null;
    readonly mean: number | null;
    readonly median: number | null;
    readonly provenance: MetricProvenance;
    readonly unavailableReasons: readonly string[];
};

export type BenchmarkExecutionResult = {
    readonly normalization: BenchmarkNormalizationEvidence | null;
    readonly lifecycle: BenchmarkLifecycleResult | null;
    readonly workload: WorkloadId;
    readonly policy: SamplingPolicy;
    readonly samples: number;
    readonly status: 'complete' | 'incomplete' | 'sampling';
    readonly assumption: 'independent-stationary-observations';
    readonly metrics: Readonly<Record<string, BenchmarkMetricSummary>>;
    readonly budgets: readonly BenchmarkBudgetResult[];
    readonly rawSamples: {
        readonly status: 'omitted' | 'recorded' | 'truncated';
        readonly reference: string | null;
        readonly reason: string | null;
    };
};

type BenchmarkCooldownPolicies = {
    readonly off: { readonly mode: 'off'; };
    readonly runtime: {
        readonly mode: 'runtime';
        readonly maximumEventLoopUtilization: number;
        readonly timeoutMilliseconds: number;
    };
};
export type BenchmarkCooldownPolicy = BenchmarkCooldownPolicies[keyof BenchmarkCooldownPolicies];

export type BenchmarkGarbageCollectionPolicy = 'after-sample' | 'off';
export type BenchmarkGarbageCollectionRequest = BenchmarkGarbageCollectionPolicy | 'profile-default';
export type BenchmarkGarbageCollectionResult = {
    readonly mode: 'after-sample';
    readonly completed: number;
    readonly failures: number;
} | {
    readonly mode: 'off';
};

type BenchmarkLifecycleTiming = {
    readonly warmupSamples: number;
    readonly cooldown: BenchmarkCooldownPolicy;
};

export type BenchmarkLifecyclePolicy = BenchmarkLifecycleTiming & {
    readonly garbageCollection: BenchmarkGarbageCollectionRequest;
};
export type ResolvedBenchmarkLifecyclePolicy = BenchmarkLifecycleTiming & {
    readonly garbageCollection: BenchmarkGarbageCollectionPolicy;
};

type BenchmarkCooldownResults = {
    readonly off: { readonly mode: 'off'; };
    readonly runtime: {
        readonly mode: 'runtime';
        readonly strategy: 'event-loop-utilization-v1';
        readonly completed: number;
        readonly windows: number;
        readonly durationMicroseconds: number;
        readonly lastUtilization: number | null;
        readonly outcome: 'cancelled' | 'pending' | 'settled' | 'timed-out' | 'unavailable';
    };
};
export type BenchmarkCooldownResult = BenchmarkCooldownResults[keyof BenchmarkCooldownResults];

export type BenchmarkLifecycleResult = {
    readonly version: typeof benchmarkLifecycleVersion;
    readonly policy: ResolvedBenchmarkLifecyclePolicy;
    readonly garbageCollection: BenchmarkGarbageCollectionResult | null;
    readonly warmup: {
        readonly samples: number;
        readonly metrics: Readonly<Record<string, BenchmarkMetricSummary>>;
        readonly rawSamples: BenchmarkExecutionResult['rawSamples'];
    };
    readonly cleanup: { readonly callbacks: number; readonly failures: number; };
    readonly cooldown: BenchmarkCooldownResult;
};

export type CalibrationIdentity = { readonly workload: WorkloadId; readonly version: string; readonly unit: string; };
export type CalibrationSnapshot = {
    readonly version: 1;
    readonly identity: CalibrationIdentity;
    readonly machineClass: string;
    readonly metadata: ReadonlyDeep<JsonValue>;
    readonly execution: { readonly nodeVersion: string; readonly nodeArguments: readonly string[]; };
    readonly sampling: SamplingPolicy;
    readonly lifecycle: BenchmarkLifecyclePolicy;
    readonly checkpoint: number;
    readonly samples: readonly number[];
};
export type CalibrationResult = { readonly kind: 'comparable'; readonly snapshot: CalibrationSnapshot; } | {
    readonly kind: 'non-comparable';
    readonly reason: string;
    readonly samples: readonly number[];
};
export type SavedCalibration = {
    readonly work: WorkId;
    readonly metric: string;
    readonly actual: CalibrationSnapshot;
    readonly budgetReference: CalibrationSnapshot;
};
export type BenchmarkNormalizationContext = {
    readonly executionId: string | null;
    readonly mode: 'capture' | 'compare';
    readonly profile: string;
    readonly machine: { readonly machineClass: string; readonly metadata: ReadonlyDeep<JsonValue>; };
    readonly references: readonly CalibrationSnapshot[];
    readonly saved: readonly SavedCalibration[];
};
export type NormalizationRuleSummary = {
    readonly garbageCollection: BenchmarkGarbageCollectionRequest;
    readonly calibration: CalibrationIdentity;
    readonly scaling: 'inverse' | 'proportional';
};
type BenchmarkNormalizationFactor = {
    readonly estimate: number;
    readonly lower: number | null;
    readonly upper: number | null;
};
export type BenchmarkMetricNormalization = {
    readonly budgetFactor: number | null;
    readonly scaling: NormalizationRuleSummary['scaling'];
    readonly actual: CalibrationSnapshot;
    readonly budgetReference: CalibrationSnapshot;
    readonly reference: CalibrationSnapshot;
    readonly source: 'baseline' | 'canonical' | 'fixed';
    readonly factor: BenchmarkNormalizationFactor | null;
    readonly summary: BenchmarkMetricSummary | null;
    readonly budgets: readonly BenchmarkBudgetResult[];
};
export type BenchmarkNormalizationEvidence = {
    readonly version: 1;
    readonly comparability: { readonly kind: 'comparable'; } | {
        readonly kind: 'non-comparable';
        readonly reason: string;
    };
    readonly calibrations: readonly CalibrationSnapshot[];
    readonly metrics: Readonly<Record<string, BenchmarkMetricNormalization>>;
};

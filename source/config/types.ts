import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { AttachmentLimits } from '../engine/runtime-attachment.ts';
import type { DefinedReporter } from '../engine/reporter.ts';
import type { DefinedOutputRenderer } from '../engine/reporter-output.ts';
import type { IntegrationRetryPolicy, IntegrationExecutionShape, MicrotestExecutionShape } from './execution.ts';

export type LoaderConfig = {
    readonly sourceMaps: boolean;
    readonly stripMode: 'strip-only';
};

export type ResourceBudgets = {
    readonly activeResourceCount: number | null;
    readonly javaScriptEngineHeapBytes: number | null;
    readonly residentSetBytes: number | null;
    readonly residentSetGrowthBytesPerSecond: number | null;
};

export type TimingCollectionMode = 'precise' | 'summary';
export type TimingCollectionOverride = 'precise' | 'profile-default';
export type TimingProfilePolicy = {
    readonly collection: TimingCollectionMode;
};

export type CoverageOutput = 'html' | 'json' | 'lcov' | 'text' | 'v8';

export type CoverageSourcePolicy = {
    readonly exclude: readonly string[];
    readonly include: NonEmptyReadonlyArray<string>;
    readonly mode: 'all';
} | {
    readonly exclude: readonly string[];
    readonly mode: 'loaded';
};

export type CoverageThresholds = {
    readonly branches: number | null;
    readonly functions: number | null;
    readonly lines: number | null;
};

export type CoveragePolicy = {
    readonly outputDirectory: string | null;
    readonly outputs: readonly CoverageOutput[];
    readonly sources: CoverageSourcePolicy;
    readonly thresholds: CoverageThresholds;
};

export type ProcessModel = 'in-process' | 'supervised-process' | 'worker-pool';
export type MicrotestProcessModel = Exclude<ProcessModel, 'worker-pool'>;
export type MaxConcurrency = number | 'unlimited';
export type Scheduling = 'concurrent' | 'serial';
export type WorkerLifecycle = 'fresh-worker-per-unit' | 'reuse';
export type WorkerPoolAssignmentPolicy = 'case-count-balanced' | 'duration-history-balanced' | 'stable';
export type WorkerPoolDispatchPolicy = 'dynamic-lease' | 'static-assignment';
export type WorkerPoolHedgingPolicy = {
    readonly durationMultiplier: number;
    readonly minimumDelayMilliseconds: number;
    readonly mode: 'on';
} | {
    readonly mode: 'off';
};
export type WorkGroupGranularity = 'case' | 'file' | 'group';
export type WorkGroupOrder = RunOrder | 'profile-default';
export type WorkGroupScheduling = Scheduling | 'profile-default';
export type WorkGroupWorkerLifecycle = WorkerLifecycle | 'profile-default';

export type HostProcess = {
    readonly kind: 'child';
    readonly nodeArguments: readonly string[];
} | {
    readonly kind: 'direct';
};

type FileWorkDistribution = { readonly mode: 'file'; };
type CaseWorkDistribution = { readonly mode: 'case'; };

export type WorkGroup = {
    readonly fileSets: NonEmptyReadonlyArray<string>;
    readonly granularity: WorkGroupGranularity;
    readonly name: string;
    readonly order: WorkGroupOrder;
    readonly scheduling: WorkGroupScheduling;
    readonly workerLifecycle: WorkGroupWorkerLifecycle;
};

type GroupWorkDistribution = {
    readonly groups: NonEmptyReadonlyArray<WorkGroup>;
    readonly mode: 'group';
    readonly unmatched: 'file' | 'reject';
};

export type WorkDistribution = CaseWorkDistribution | FileWorkDistribution | GroupWorkDistribution;

export type MicrotestExecution = MicrotestExecutionShape<
    MaxConcurrency,
    MicrotestProcessModel,
    Scheduling
>;
export type IntegrationExecution = IntegrationExecutionShape<
    WorkerPoolAssignmentPolicy,
    WorkerPoolDispatchPolicy,
    WorkerPoolHedgingPolicy,
    HostProcess,
    MaxConcurrency,
    Scheduling,
    WorkerLifecycle,
    WorkDistribution
>;

export type ResourceUsagePolicy = {
    readonly budgets: ResourceBudgets;
    readonly measure: boolean;
    readonly samplingIntervalMilliseconds: number;
};

export type TimeoutPolicy = {
    readonly collectionMilliseconds: number;
    readonly hardMilliseconds: number;
    readonly softMilliseconds: number;
};

type ProfileFilePatterns = {
    readonly exclude: readonly string[];
    readonly include: NonEmptyReadonlyArray<string>;
    readonly sets?: never;
};

export type ProfileFileSet = {
    readonly exclude: readonly string[];
    readonly include: NonEmptyReadonlyArray<string>;
};

export type ProfileFiles = ProfileFilePatterns | {
    readonly exclude?: never;
    readonly include?: never;
    readonly sets: Readonly<Record<string, ProfileFileSet>>;
};

export type MicrotestProfileConfig = {
    readonly coverage: CoveragePolicy;
    readonly execution: MicrotestExecution;
    readonly files: ProfileFiles | null;
    readonly reporters: readonly DefinedReporter[] | null;
    readonly resourceUsage: ResourceUsagePolicy;
    readonly testFamily: 'microtest';
    readonly timings: TimingProfilePolicy;
    readonly timeouts: TimeoutPolicy;
};

export type IntegrationProfileConfig = {
    readonly attachments: AttachmentLimits;
    readonly retries: IntegrationRetryPolicy | null;
    readonly execution: IntegrationExecution;
    readonly files: ProfileFiles;
    readonly reporters: readonly DefinedReporter[] | null;
    readonly resourceUsage: ResourceUsagePolicy;
    readonly testFamily: 'integration';
    readonly timings: TimingProfilePolicy;
    readonly timeouts: TimeoutPolicy;
};

export type BenchmarkExecution = IntegrationExecutionShape<
    WorkerPoolAssignmentPolicy,
    WorkerPoolDispatchPolicy,
    Extract<WorkerPoolHedgingPolicy, { readonly mode: 'off'; }>,
    HostProcess,
    1,
    'serial',
    WorkerLifecycle,
    WorkDistribution
>;

export type BenchmarkProfileConfig = {
    readonly attachments: AttachmentLimits;
    readonly execution: BenchmarkExecution;
    readonly files: ProfileFiles;
    readonly reporters: readonly DefinedReporter[] | null;
    readonly resourceUsage: ResourceUsagePolicy;
    readonly testFamily: 'benchmark';
    readonly timings: TimingProfilePolicy;
    readonly timeouts: TimeoutPolicy;
};

export type TestProfileConfig = IntegrationProfileConfig | MicrotestProfileConfig;
export type ProfileConfig = BenchmarkProfileConfig | TestProfileConfig;

export type ProfilesConfig = Readonly<Record<string, ProfileConfig>>;

export type NormalizedConfig = {
    readonly loader: LoaderConfig;
    readonly outputRenderer: DefinedOutputRenderer;
    readonly profiles: ProfilesConfig;
    readonly reporters: readonly DefinedReporter[] | null;
    readonly runtimeStateDir: string;
};
export type RunOrder = 'lexical' | 'plan' | 'seeded';

import type { BenchmarkGarbageCollectionPolicy } from '../engine/benchmark-result.ts';
import type { PropertyPolicy } from '../engine/property-node.ts';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { BenchmarkBaselinePolicy, OrdinaryBaselinePolicy } from '../baselines/baseline-policy.ts';
import type { ProfileEvidencePolicy } from './evidence-policy.ts';
import type { ReportingPolicy } from './reporting-schema.ts';
import type { RunAdapterRegistration } from './adapter-profile.ts';
import type { HistoryPolicy } from './history-policy.ts';
import type { BenchmarkHostPolicy } from './benchmark-host.ts';
import type {
    IntegrationRetryPolicy as IntegrationRetryPolicyDefinition,
    IntegrationExecutionShape,
    MicrotestExecutionShape
} from './execution.ts';

export type LoaderConfig = {
    readonly sourceMaps: boolean;
    readonly stripMode: 'strip-only';
};

export type ProcessBudgets = {
    readonly activeResourceCount: number | null;
    readonly javaScriptEngineHeapBytes: number | null;
    readonly residentSetBytes: number | null;
    readonly residentSetGrowthBytesPerSecond: number | null;
};

export type RunRecordPersistenceMode = 'always' | 'on-demand';
export type RunRecordProfilePolicy = { readonly persist: RunRecordPersistenceMode; };

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

export type ProcessUsagePolicy = {
    readonly budgets: ProcessBudgets;
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
    readonly baselines: OrdinaryBaselinePolicy;
    readonly coverage: CoveragePolicy;
    readonly execution: MicrotestExecution;
    readonly files: ProfileFiles | null;
    readonly reporters: ReportingPolicy['reporters'];
    readonly processUsage: ProcessUsagePolicy;
    readonly testFamily: 'microtest';
    readonly runRecords: RunRecordProfilePolicy;
    readonly failureArtifacts: ProfileEvidencePolicy['failureArtifacts'];
    readonly timings: TimingProfilePolicy;
    readonly timeouts: TimeoutPolicy;
};

export type IntegrationProfileConfig = {
    readonly baselines: OrdinaryBaselinePolicy;
    readonly attachments: ProfileEvidencePolicy['attachments'];
    readonly retries: IntegrationRetryPolicy | null;
    readonly execution: IntegrationExecution;
    readonly files: ProfileFiles;
    readonly reporters: ReportingPolicy['reporters'];
    readonly processUsage: ProcessUsagePolicy;
    readonly testFamily: 'integration';
    readonly runRecords: RunRecordProfilePolicy;
    readonly failureArtifacts: ProfileEvidencePolicy['failureArtifacts'];
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
    readonly garbageCollection: BenchmarkGarbageCollectionPolicy;
    readonly host: BenchmarkHostPolicy;
    readonly baselines: BenchmarkBaselinePolicy;
    readonly attachments: ProfileEvidencePolicy['attachments'];
    readonly execution: BenchmarkExecution;
    readonly files: ProfileFiles;
    readonly reporters: ReportingPolicy['reporters'];
    readonly processUsage: ProcessUsagePolicy;
    readonly testFamily: 'benchmark';
    readonly runRecords: RunRecordProfilePolicy;
    readonly failureArtifacts: ProfileEvidencePolicy['failureArtifacts'];
    readonly timings: TimingProfilePolicy;
    readonly timeouts: TimeoutPolicy;
};

export type PropertyCorpusPolicy = {
    readonly checkedIn: readonly string[];
    readonly localCache: { readonly maxEntries: number; readonly maxBytes: number; readonly maxEntryBytes: number; };
};
export type PropertyProfileConfig = {
    readonly baselines: OrdinaryBaselinePolicy;
    readonly corpus: PropertyCorpusPolicy;
    readonly execution: MicrotestExecution;
    readonly files: ProfileFiles;
    readonly reporters: ReportingPolicy['reporters'];
    readonly processUsage: ProcessUsagePolicy;
    readonly property: PropertyPolicy;
    readonly testFamily: 'property';
    readonly runRecords: RunRecordProfilePolicy;
    readonly failureArtifacts: ProfileEvidencePolicy['failureArtifacts'];
    readonly timings: TimingProfilePolicy;
    readonly timeouts: TimeoutPolicy;
};

export type AdapterProfileConfig = {
    readonly execution: {
        readonly processModel: 'in-process';
        readonly maxConcurrency: 1;
        readonly scheduling: 'serial';
    };
    readonly files: ProfileFiles;
    readonly reporters: ReportingPolicy['reporters'];
    readonly processUsage: ProcessUsagePolicy;
    readonly runRecords: RunRecordProfilePolicy;
    readonly failureArtifacts: ProfileEvidencePolicy['failureArtifacts'];
    readonly timings: TimingProfilePolicy;
    readonly timeouts: TimeoutPolicy;
    readonly testFamily: 'type-test';
    readonly adapter: RunAdapterRegistration;
    readonly settings: unknown;
};

export type BuiltinTestProfileConfig = IntegrationProfileConfig | MicrotestProfileConfig | PropertyProfileConfig;
export type TestProfileConfig = AdapterProfileConfig | BuiltinTestProfileConfig;
export type ProfileConfig = BenchmarkProfileConfig | TestProfileConfig;

export type ProfilesConfig = Readonly<Record<string, ProfileConfig>>;

export type NormalizedConfig = {
    readonly history: HistoryPolicy;
    readonly loader: LoaderConfig;
    readonly outputRenderer: ReportingPolicy['outputRenderer'];
    readonly profiles: ProfilesConfig;
    readonly reporters: ReportingPolicy['reporters'];
    readonly runtimeStateDir: string;
};
export type RunOrder = 'lexical' | 'plan' | 'seeded';

export type IntegrationRetryPolicy = IntegrationRetryPolicyDefinition;

export type ConfigLoadRequest = {
    readonly configPath: string | null;
    readonly cwd: string;
};

export type RunRecordPersistenceReason = 'artifact' | 'coverage' | 'debug' | 'last-failed' | 'profile' | 'request';
export type RunRecordPersistenceFacts = {
    readonly persist: boolean;
    readonly reasons: readonly RunRecordPersistenceReason[];
};

export function isBuiltinTestProfile(profile: ProfileConfig): profile is BuiltinTestProfileConfig {
    return [ 'microtest', 'property', 'integration' ].includes(profile.testFamily);
}

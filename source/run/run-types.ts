import type { Except } from 'type-fest';
import type { NonEmptyReadonlyArray, SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import type { SerializedValue as SerializedValueShape } from '../compare/serialized-value.ts';
import type { AttachmentCoordinator } from './attachment-coordinator-context.ts';
import type {
    AttachmentLimits,
    Execute,
    OrphanedNode,
    RunResult,
    TestPlan,
    TestPlanRootOptions,
    WorkId as EngineWorkId,
    RuntimeId,
    WorkloadId
} from './run-engine-primitives.ts';
import type { RunEngineSelection, RunSelection } from './run-request-types.ts';
import type { RunInvocationTimingOptions } from './run-timing-collection.ts';
import type {
    IntegrationRetryPolicy,
    RunExecutionResourceOwnershipPlan,
    RunIntegrationExecutionShape,
    RunMicrotestExecutionShape
} from './run-execution-config.ts';

export type SerializedValue = SerializedValueShape;
export type WorkId = EngineWorkId;
export type RunCollectionRoot = TestPlanRootOptions;
type RunExecuteOptions = NonNullable<Parameters<Execute>[1]>;
type RunReporters = RunExecuteOptions['reporters'];

export type RunShard = {
    readonly index: number;
    readonly total: number;
};

export type RunShardHashAlgorithm = 'xxh3-64-canonical-json-v1';

export type RunExecutionRequest = { readonly mode: 'profile-default'; };

type RunCapabilityRestrictionsRequest = { readonly mode: 'disabled' | 'enabled'; };

export type RunSeed = { readonly value: bigint | null; };

export type RunDebugRequest = {
    readonly mode: 'off';
    readonly selectors: readonly [];
};

export type RunLoaderConfig = {
    readonly sourceMaps: boolean;
    readonly stripMode: 'strip-only';
};

export type RunResourceBudgets = {
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

export type RunCoverageSourcePolicy = {
    readonly exclude: readonly string[];
    readonly include: NonEmptyReadonlyArray<string>;
    readonly mode: 'all';
} | {
    readonly exclude: readonly string[];
    readonly mode: 'loaded';
};

export type RunCoverageThresholds = {
    readonly branches: number | null;
    readonly functions: number | null;
    readonly lines: number | null;
};

export type RunCoveragePolicy = {
    readonly outputDirectory: string | null;
    readonly outputs: readonly CoverageOutput[];
    readonly sources: RunCoverageSourcePolicy;
    readonly thresholds: RunCoverageThresholds;
};

export type RunTestFamily = 'integration' | 'microtest';
export type RunProcessModel = 'in-process' | 'supervised-process' | 'worker-pool';
export type RunMicrotestProcessModel = Exclude<RunProcessModel, 'worker-pool'>;
export type RunMaxConcurrency = number | 'unlimited';
export type RunScheduling = 'concurrent' | 'serial';
export type RunWorkerLifecycle = 'fresh-worker-per-unit' | 'reuse';
export type RunWorkerPoolAssignmentPolicy = 'case-count-balanced' | 'duration-history-balanced' | 'stable';
export type RunWorkerPoolDispatchPolicy = 'dynamic-lease' | 'static-assignment';
export type RunWorkerPoolHedgingPolicy = {
    readonly durationMultiplier: number;
    readonly minimumDelayMilliseconds: number;
    readonly mode: 'on';
} | {
    readonly mode: 'off';
};
export type RunWorkGroupGranularity = 'case' | 'file' | 'group';
export type RunWorkGroupOrder = RunOrder | 'profile-default';
export type RunWorkGroupScheduling = RunScheduling | 'profile-default';
export type RunWorkGroupWorkerLifecycle = RunWorkerLifecycle | 'profile-default';

type RunHostProcessReasonKey = {
    readonly 'benchmark-isolation': true;
    readonly debugging: true;
    readonly 'forced-garbage-collection': true;
    readonly 'host-isolation': true;
    readonly 'node-arguments': true;
    readonly profiling: true;
};

export type RunHostProcessReason = keyof RunHostProcessReasonKey;

export type RunHostProcess = {
    readonly kind: 'child';
    readonly nodeArguments: readonly string[];
} | {
    readonly kind: 'direct';
};

type FileRunWorkDistribution = { readonly mode: 'file'; };
type CaseRunWorkDistribution = { readonly mode: 'case'; };

export type RunWorkGroup = {
    readonly fileSets: NonEmptyReadonlyArray<string>;
    readonly granularity: RunWorkGroupGranularity;
    readonly name: string;
    readonly order: RunWorkGroupOrder;
    readonly scheduling: RunWorkGroupScheduling;
    readonly workerLifecycle: RunWorkGroupWorkerLifecycle;
};

type GroupRunWorkDistribution = {
    readonly groups: NonEmptyReadonlyArray<RunWorkGroup>;
    readonly mode: 'group';
    readonly unmatched: 'file' | 'reject';
};

export type RunWorkDistribution = CaseRunWorkDistribution | FileRunWorkDistribution | GroupRunWorkDistribution;

export type WorkUnitMode = 'case' | 'file' | 'group';

export type WorkUnitId = {
    readonly key: string;
    readonly mode: WorkUnitMode;
    readonly runtimes: readonly RuntimeId[];
    readonly workload: WorkloadId | null;
};

export type WorkUnitResourceConstraints = {
    readonly affinityKeys: readonly string[];
    readonly capacityWeight: number;
    readonly duplicateExecution: readonly DuplicateExecutionSafety[];
    readonly faultDomains: readonly string[];
    readonly serialKeys: readonly string[];
    readonly singleWorkerKeys: readonly string[];
};

export type DuplicateExecutionSafety = 'disposable-isolated' | 'idempotent';

export const emptyWorkUnitResourceConstraints: WorkUnitResourceConstraints = Object.freeze({
    affinityKeys: Object.freeze([]),
    capacityWeight: 1,
    duplicateExecution: Object.freeze([]),
    faultDomains: Object.freeze([]),
    serialKeys: Object.freeze([]),
    singleWorkerKeys: Object.freeze([])
});

export type WorkUnit = {
    readonly group: string | null;
    readonly id: WorkUnitId;
    readonly order: RunOrder;
    readonly resourceConstraints: WorkUnitResourceConstraints;
    readonly scheduling: RunScheduling;
    readonly work: NonEmptyReadonlyArray<WorkId>;
    readonly workerLifecycle: RunWorkerLifecycle;
};

export type ExecutorDescriptor = {
    readonly capabilities: readonly string[];
    readonly capacity: number;
    readonly id: string;
    readonly kind: 'browser' | 'local-process' | 'local-worker' | 'remote';
};

export type PlacementLane = {
    readonly executor: ExecutorDescriptor;
    readonly id: string;
};

export type PlacementAssignment = {
    readonly lane: PlacementLane['id'];
    readonly unit: WorkUnitId;
};

export type PlacementPlan = {
    readonly assignments: readonly PlacementAssignment[];
    readonly lanes: readonly PlacementLane[];
    readonly resourceOwnership: RunExecutionResourceOwnershipPlan;
    readonly units: readonly WorkUnit[];
};

export type RunMicrotestExecution = RunMicrotestExecutionShape<
    RunMaxConcurrency,
    RunMicrotestProcessModel,
    RunScheduling
>;
export type RunIntegrationExecution = RunIntegrationExecutionShape<
    RunWorkerPoolAssignmentPolicy,
    RunWorkerPoolDispatchPolicy,
    RunWorkerPoolHedgingPolicy,
    RunHostProcess,
    RunMaxConcurrency,
    RunScheduling,
    RunWorkerLifecycle,
    RunWorkDistribution
>;

export type RunResourceUsagePolicy = {
    readonly budgets: RunResourceBudgets;
    readonly measure: boolean;
    readonly samplingIntervalMilliseconds: number;
};

export type RunTimeoutPolicy = {
    readonly collectionMilliseconds: number;
    readonly hardMilliseconds: number;
    readonly softMilliseconds: number;
};

type RunProfileFilePatterns = {
    readonly exclude: readonly string[];
    readonly include: NonEmptyReadonlyArray<string>;
    readonly sets?: never;
};

export type RunProfileFileSet = {
    readonly exclude: readonly string[];
    readonly include: NonEmptyReadonlyArray<string>;
};

export type RunProfileFiles = RunProfileFilePatterns | {
    readonly exclude?: never;
    readonly include?: never;
    readonly sets: Readonly<Record<string, RunProfileFileSet>>;
};

export type RunMicrotestProfileConfig = {
    readonly coverage: RunCoveragePolicy;
    readonly execution: RunMicrotestExecution;
    readonly files: RunProfileFiles | null;
    readonly reporters: RunReporters | null;
    readonly resourceUsage: RunResourceUsagePolicy;
    readonly testFamily: 'microtest';
    readonly timings: TimingProfilePolicy;
    readonly timeouts: RunTimeoutPolicy;
};

export type RunIntegrationProfileConfig = {
    readonly attachments: AttachmentLimits;
    readonly retries: IntegrationRetryPolicy | null;
    readonly execution: RunIntegrationExecution;
    readonly files: RunProfileFiles;
    readonly reporters: RunReporters | null;
    readonly resourceUsage: RunResourceUsagePolicy;
    readonly testFamily: 'integration';
    readonly timings: TimingProfilePolicy;
    readonly timeouts: RunTimeoutPolicy;
};

export type RunProfileConfig = RunIntegrationProfileConfig | RunMicrotestProfileConfig;

export type RunProfilesConfig = Readonly<Record<string, RunProfileConfig>>;

export type RunConfig = {
    readonly loader: RunLoaderConfig;
    readonly outputRenderer: NonNullable<RunExecuteOptions['outputRenderer']>;
    readonly profiles: RunProfilesConfig;
    readonly reporters: RunReporters;
    readonly runtimeStateDir: string;
};
export type DurationHistoryObservation = {
    readonly durationMicroseconds: number;
    readonly metadata: {
        readonly processModel: RunProcessModel;
        readonly profile: string;
        readonly scheduling: RunScheduling;
        readonly testFamily: RunTestFamily;
        readonly workerLifecycle: RunWorkerLifecycle | null;
    };
    readonly observedAt: string;
};
export type DurationHistorySample = {
    readonly durationMicroseconds: number;
    readonly observedAt: string;
    readonly observations: readonly DurationHistoryObservation[];
    readonly sampleCount: number;
    readonly work: WorkId;
};
export type DurationHistoryInput = {
    readonly generatedAt: string;
    readonly samples: readonly DurationHistorySample[];
    readonly source: 'runtime-state-index';
};
export type RunOrder = 'lexical' | 'plan' | 'seeded';

export type RunRequest = {
    readonly baselineUpdateMode: 'none';
    readonly capabilityRestrictions: RunCapabilityRestrictionsRequest;
    readonly capture: 'buffered' | 'live';
    readonly coverage: boolean;
    readonly debug: RunDebugRequest;
    readonly execution: RunExecutionRequest;
    readonly measureResourceUsage: boolean | null;
    readonly order: RunOrder;
    readonly paths: readonly string[];
    readonly profile: string;
    readonly resourceBudgetOverrides: RunResourceBudgets | null;
    readonly resourceUsageSamplingIntervalMilliseconds: number | null;
    readonly seed: RunSeed;
    readonly selection: RunSelection;
    readonly shard: RunShard;
    readonly timingCollection: TimingCollectionOverride;
    readonly verbose: false;
    readonly workers: number | null;
};

export type RunCommand = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunEngineSelection;
    readonly request: RunRequest;
};

export type RunFacts = {
    readonly coveragePolicy: RunCoveragePolicy | null;
    readonly cases: readonly RunCaseFacts[];
    readonly durationHistory: DurationHistoryInput | null;
    readonly environment: RunEnvironmentFacts;
    readonly execution: RunExecutionFacts;
    readonly loader: RunLoaderConfig;
    readonly reproducibility: RunReproducibilityFacts;
};

export type RunCaseFacts = {
    readonly annotations: SerializedValue;
    readonly controls: SerializedValue;
    readonly fileSet: string | null;
    readonly id: TestPlan['cases'][number]['id'];
    readonly workId: WorkId;
};

export type RunEnvironmentFacts = {
    readonly node: {
        readonly arch: string;
        readonly platform: string;
        readonly version: string;
    };
    readonly projectRoot: string;
    readonly runtimeStateDir: string;
};

type RunExecutionBaseFacts = {
    readonly attachments: AttachmentLimits | null;
    readonly retries: IntegrationRetryPolicy | null;
    readonly baselineUpdateMode: 'none';
    readonly capture: 'buffered' | 'live';
    readonly coverage: boolean;
    readonly debug: RunDebugRequest;
    readonly engine: RunEngineFacts;
    readonly maxConcurrency: RunMaxConcurrency;
    readonly order: RunOrder;
    readonly placementPlan: PlacementPlan | null;
    readonly profile: string;
    readonly resourceUsagePolicy: RunResourceUsagePolicy;
    readonly scheduling: RunScheduling;
    readonly testFamily: RunTestFamily;
    readonly timingCollection: TimingCollectionMode;
    readonly timeoutPolicy: RunTimeoutPolicy;
    readonly verbose: false;
};

type RunWorkerPoolExecutionFacts = RunExecutionBaseFacts & {
    readonly assignmentPolicy: RunWorkerPoolAssignmentPolicy;
    readonly dispatchPolicy: RunWorkerPoolDispatchPolicy;
    readonly hedging: RunWorkerPoolHedgingPolicy;
    readonly hostProcess: RunHostProcessFacts;
    readonly processModel: 'worker-pool';
    readonly workerCount: RunWorkerCountFacts;
    readonly workDistribution: RunWorkDistribution;
    readonly workerLifecycle: RunWorkerLifecycle;
};

export type RunWorkerCountFacts = {
    readonly hostMaximum: number;
    readonly profileMaximum: number | null;
    readonly requested: number | null;
    readonly resolved: number;
};

export type RunHostProcessFacts = {
    readonly kind: 'child';
    readonly nodeArguments: readonly string[];
    readonly reasons: NonEmptyReadonlyArray<RunHostProcessReason>;
} | {
    readonly kind: 'direct';
};

type RunSingleProcessExecutionFacts = RunExecutionBaseFacts & {
    readonly processModel: RunMicrotestProcessModel | 'supervised-process';
};

export type RunExecutionFacts = RunSingleProcessExecutionFacts | RunWorkerPoolExecutionFacts;

export type RunReproducibilityFacts = {
    readonly selection: RunSelection;
    readonly seed: string;
    readonly shard: RunShard;
    readonly shardHashAlgorithm: RunShardHashAlgorithm;
};

export type RunEngineFacts = {
    readonly exportKind: 'getter' | 'value';
    readonly exportName: string;
    readonly kind: 'module';
    readonly moduleUrl: string;
} | {
    readonly kind: 'default';
} | {
    readonly kind: 'instance';
};

type CollectedSuitePathEntry = {
    readonly definitionLocations: NonEmptyReadonlyArray<SourceLocation>;
    readonly title: string;
};

export type CollectedRunCase = {
    readonly annotations: TestPlan['cases'][number]['annotations'];
    readonly controls: TestPlan['cases'][number]['controls'];
    readonly definitionLocations: NonEmptyReadonlyArray<SourceLocation>;
    readonly params: string | null;
    readonly resourceAttachments: TestPlan['cases'][number]['resourceAttachments'];
    readonly suitePath: readonly CollectedSuitePathEntry[];
    readonly testFamily: TestPlan['cases'][number]['testFamily'];
    readonly title: string;
    readonly workId?: WorkId;
};

export type CollectedRunFile = { readonly cases: readonly CollectedRunCase[]; readonly file: string; };

export type CollectedOrphanedNode = Except<OrphanedNode, 'definitionLocations'> & {
    readonly definitionLocations: NonEmptyReadonlyArray<SourceLocation>;
};

export type CollectedRunPlan = {
    readonly defined: number;
    readonly discoveredFiles: readonly CollectedRunFile[];
    readonly files: readonly CollectedRunFile[];
    readonly orphans: readonly CollectedOrphanedNode[];
    readonly root: Pick<TestPlan['root'], 'annotations' | 'controls' | 'title'>;
};

export type ResolvedRunPlan = {
    readonly collectedPlan: CollectedRunPlan;
    readonly kind: 'empty-shard';
} | {
    readonly collectedPlan: CollectedRunPlan;
    readonly kind: 'supervised';
} | {
    readonly collectedPlan: CollectedRunPlan;
    readonly kind: 'worker-pool';
} | {
    readonly kind: 'local';
    readonly testPlan: TestPlan;
};

export type ResolvedRun = {
    readonly collectionRunnerErrors: readonly RunResult['runnerErrors'][number][];
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunEngineSelection;
    readonly facts: RunFacts;
    readonly plan: ResolvedRunPlan;
    readonly reporters: RunReporters;
    readonly request: RunRequest;
};

export type RunOrchestrator = {
    readonly resolve: (command: RunCommand, options?: RunInvocationTimingOptions) => Promise<ResolvedRun>;
    readonly run: (command: RunCommand, options?: RunInvocationTimingOptions) => Promise<RunResult>;
    readonly runWithReporterDelivery: (command: RunCommand, options?: RunInvocationTimingOptions) => Promise<{
        readonly deliveredRunnerErrors: readonly RunResult['runnerErrors'][number][];
        readonly result: RunResult;
        readonly undeliveredRunnerErrors: readonly RunResult['runnerErrors'][number][];
    }>;
};

export type RunRuntimeAttachments = AttachmentCoordinator | null;

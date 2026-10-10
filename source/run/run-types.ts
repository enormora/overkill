import type { Except } from 'type-fest';
import type {
    BenchmarkCalibrationResult,
    BaselineChange,
    BaselineEntry,
    BaselineUpdateMode,
    BaselineWriteOutcome
} from '../baselines/performance-baseline.ts';
import type {
    IntegrationRetryPolicy,
    LoaderConfig,
    ResourceBudgets,
    TimingCollectionMode,
    TimingCollectionOverride,
    CoveragePolicy,
    ProcessModel,
    MicrotestProcessModel,
    MaxConcurrency,
    Scheduling,
    WorkerLifecycle,
    WorkerPoolAssignmentPolicy,
    WorkerPoolDispatchPolicy,
    WorkerPoolHedgingPolicy,
    WorkDistribution,
    ResourceUsagePolicy,
    TimeoutPolicy,
    NormalizedConfig,
    RunOrder
} from '../config/types.ts';
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
import type { ResourceOwnershipPlan } from './resource-ownership-plan.ts';

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

export type RunExecutionRequest = { readonly mode: 'profile-default'; } | { readonly mode: 'serial'; };

type RunCapabilityRestrictionsRequest = { readonly mode: 'disabled' | 'enabled'; };

export type RunSeed = { readonly value: bigint | null; };

export type RunDebugRequest = {
    readonly mode: 'off';
    readonly selectors: readonly [];
};

export type RunTestFamily = 'benchmark' | 'integration' | 'microtest';
type RunHostProcessReasonKey = {
    readonly 'benchmark-isolation': true;
    readonly debugging: true;
    readonly 'forced-garbage-collection': true;
    readonly 'host-isolation': true;
    readonly 'node-arguments': true;
    readonly profiling: true;
};

export type RunHostProcessReason = keyof RunHostProcessReasonKey;

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
    readonly scheduling: Scheduling;
    readonly work: NonEmptyReadonlyArray<WorkId>;
    readonly workerLifecycle: WorkerLifecycle;
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
    readonly resourceOwnership: ResourceOwnershipPlan;
    readonly units: readonly WorkUnit[];
};

export type DurationHistoryObservation = {
    readonly durationMicroseconds: number;
    readonly metadata: {
        readonly processModel: ProcessModel;
        readonly profile: string;
        readonly scheduling: Scheduling;
        readonly testFamily: RunTestFamily;
        readonly workerLifecycle: WorkerLifecycle | null;
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

export type ProfileRunRequest<Profile extends string | null> = {
    readonly baselineUpdateMode: BaselineUpdateMode;
    readonly capabilityRestrictions: RunCapabilityRestrictionsRequest;
    readonly capture: 'buffered' | 'live';
    readonly coverage: boolean;
    readonly debug: RunDebugRequest;
    readonly execution: RunExecutionRequest;
    readonly measureResourceUsage: boolean | null;
    readonly order: RunOrder;
    readonly paths: readonly string[];
    readonly profile: Profile;
    readonly resourceBudgetOverrides: ResourceBudgets | null;
    readonly resourceUsageSamplingIntervalMilliseconds: number | null;
    readonly seed: RunSeed;
    readonly selection: RunSelection;
    readonly shard: RunShard;
    readonly timingCollection: TimingCollectionOverride;
    readonly verbose: false;
    readonly workers: number | null;
};

export type RunRequest = ProfileRunRequest<string>;

export type RunCommand = {
    readonly config: NormalizedConfig;
    readonly cwd: string;
    readonly engine: RunEngineSelection;
    readonly request: RunRequest;
};

export type RunFacts = {
    readonly benchmarkCalibration: BenchmarkCalibrationResult | null;
    readonly coveragePolicy: CoveragePolicy | null;
    readonly cases: readonly RunCaseFacts[];
    readonly durationHistory: DurationHistoryInput | null;
    readonly environment: RunEnvironmentFacts;
    readonly execution: RunExecutionFacts;
    readonly loader: LoaderConfig;
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
    readonly baselineUpdateMode: BaselineUpdateMode;
    readonly capture: 'buffered' | 'live';
    readonly coverage: boolean;
    readonly debug: RunDebugRequest;
    readonly engine: RunEngineFacts;
    readonly maxConcurrency: MaxConcurrency;
    readonly order: RunOrder;
    readonly placementPlan: PlacementPlan | null;
    readonly profile: string;
    readonly resourceUsagePolicy: ResourceUsagePolicy;
    readonly scheduling: Scheduling;
    readonly testFamily: RunTestFamily;
    readonly timingCollection: TimingCollectionMode;
    readonly timeoutPolicy: TimeoutPolicy;
    readonly verbose: false;
};

type RunWorkerPoolExecutionFacts = RunExecutionBaseFacts & {
    readonly assignmentPolicy: WorkerPoolAssignmentPolicy;
    readonly dispatchPolicy: WorkerPoolDispatchPolicy;
    readonly hedging: WorkerPoolHedgingPolicy;
    readonly hostProcess: RunHostProcessFacts;
    readonly processModel: 'worker-pool';
    readonly workerCount: RunWorkerCountFacts;
    readonly workDistribution: WorkDistribution;
    readonly workerLifecycle: WorkerLifecycle;
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
    readonly processModel: MicrotestProcessModel | 'supervised-process';
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
    readonly config: NormalizedConfig;
    readonly cwd: string;
    readonly engine: RunEngineSelection;
    readonly facts: RunFacts;
    readonly plan: ResolvedRunPlan;
    readonly reporters: RunReporters;
    readonly request: RunRequest;
};

export type RunReporterDeliveryResult = {
    readonly deliveredRunnerErrors: readonly RunResult['runnerErrors'][number][];
    readonly result: RunResult;
    readonly undeliveredRunnerErrors: readonly RunResult['runnerErrors'][number][];
};

export type BenchmarkBaselineCommand = Except<RunCommand, 'request'> & {
    readonly request: Except<RunRequest, 'baselineUpdateMode'>;
};

export type BenchmarkBaselineListCommand = Pick<RunCommand, 'config' | 'cwd'> & {
    readonly request: Pick<RunRequest, 'paths' | 'profile'>;
};

export type BenchmarkBaselineRunResult = RunReporterDeliveryResult & {
    readonly changes: readonly BaselineChange[];
    readonly writeOutcome: BaselineWriteOutcome;
};

export type BenchmarkBaselineOrchestrator = {
    readonly apply: (
        command: BenchmarkBaselineCommand,
        options: RunInvocationTimingOptions
    ) => Promise<BenchmarkBaselineRunResult>;
    readonly bootstrap: (
        command: BenchmarkBaselineCommand,
        options: RunInvocationTimingOptions
    ) => Promise<BenchmarkBaselineRunResult>;
    readonly diff: (
        command: BenchmarkBaselineCommand,
        options: RunInvocationTimingOptions
    ) => Promise<BenchmarkBaselineRunResult>;
    readonly list: (command: BenchmarkBaselineListCommand) => Promise<readonly BaselineEntry[]>;
    readonly update: (
        command: BenchmarkBaselineCommand,
        options: RunInvocationTimingOptions
    ) => Promise<BenchmarkBaselineRunResult>;
};

export type BenchmarkOrchestrator = {
    readonly baseline: BenchmarkBaselineOrchestrator;
    readonly list: (command: RunCommand, options: RunInvocationTimingOptions) => Promise<ResolvedRun>;
    readonly run: (command: RunCommand, options: RunInvocationTimingOptions) => Promise<RunResult>;
    readonly runWithReporterDelivery: (
        command: RunCommand,
        options: RunInvocationTimingOptions
    ) => Promise<RunReporterDeliveryResult>;
};

export type RunOrchestrator = {
    readonly bench: BenchmarkOrchestrator;
    readonly resolve: (command: RunCommand, options?: RunInvocationTimingOptions) => Promise<ResolvedRun>;
    readonly run: (command: RunCommand, options?: RunInvocationTimingOptions) => Promise<RunResult>;
    readonly runWithReporterDelivery: (
        command: RunCommand,
        options?: RunInvocationTimingOptions
    ) => Promise<RunReporterDeliveryResult>;
};

export type RunRuntimeAttachments = AttachmentCoordinator | null;

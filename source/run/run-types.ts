import type { Except, JsonValue } from 'type-fest';
import type { BenchmarkHostAssessment, BenchmarkPlacementFacts } from '../bench/benchmark-host-snapshot.ts';
import type {
    BenchmarkCalibrationResult,
    CalibrationReferenceChange,
    BaselineChange,
    BaselineEntry,
    BaselineUpdateMode,
    BaselineWriteOutcome
} from '../baselines/performance-baseline.ts';
import type {
    BenchmarkProfileConfig,
    ConfigLoadRequest,
    CoveragePolicy,
    IntegrationRetryPolicy,
    LoaderConfig,
    MaxConcurrency,
    MicrotestProcessModel,
    MicrotestProfileConfig,
    NormalizedConfig,
    ProfileConfig,
    ProcessBudgets,
    ProcessUsagePolicy,
    RunOrder,
    RunRecordPersistenceFacts,
    Scheduling,
    TimeoutPolicy,
    TimingCollectionMode,
    TimingCollectionOverride,
    WorkDistribution,
    WorkerLifecycle,
    WorkerPoolAssignmentPolicy,
    WorkerPoolDispatchPolicy,
    WorkerPoolHedgingPolicy
} from '../config/types.ts';
import type {
    NonEmptyReadonlyArray,
    SourceLocation,
    SerializedValue as SerializedValueShape
} from '../assertion-protocol/assertion-node-shape.ts';
import type {
    WorkUnitMode as WorkUnitModeDefinition,
    WorkUnitId as WorkUnitIdDefinition,
    WorkUnitResourceConstraints as WorkUnitResourceConstraintsDefinition,
    DuplicateExecutionSafety as DuplicateExecutionSafetyDefinition,
    WorkUnit as WorkUnitDefinition,
    ExecutorDescriptor as ExecutorDescriptorDefinition,
    PlacementLane as PlacementLaneDefinition,
    PlacementAssignment as PlacementAssignmentDefinition,
    PlacementPlan as PlacementPlanDefinition,
    DurationHistoryObservation as DurationHistoryObservationDefinition,
    DurationHistorySample as DurationHistorySampleDefinition,
    DurationHistoryInput as DurationHistoryInputDefinition
} from './work-unit-types.ts';
import type {
    RecordedRunSource,
    RunHistoryRequest,
    RunHostProcessReason as RunHostProcessReasonDefinition,
    RunEngineSelection,
    RunSelection as SelectedCases,
    RunExecutionLifecycleReference
} from './run-request-types.ts';
import type { AttachmentCoordinator } from './attachment-coordinator-context.ts';
import type {
    PropertyPolicy,
    PropertyCorpusSnapshot,
    PropertyBodyDefinition,
    AttachmentLimits,
    PerTestResult,
    RunnerError,
    Execute,
    ExecuteDependencies,
    OrphanedNode,
    RunResult,
    TestPlan,
    TestPlanCase,
    Engine,
    TestPlanRootOptions,
    WorkId as EngineWorkId
} from './run-engine-primitives.ts';
import type { RunInvocationTimingOptions } from './run-timing-collection.ts';

export type SerializedValue = SerializedValueShape;
export type WorkId = EngineWorkId;
export type FrozenWorkloadInput = {
    readonly work: WorkId;
    readonly parameters: TestPlan['cases'][number]['workloadParameters'];
};
export type RunCollectionRoot = TestPlanRootOptions;
type BenchmarkDefinitionSummary = Extract<TestPlanCase['execution'], { readonly bodyMode: 'benchmark'; }>['definition'];
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
    readonly mode: 'all' | 'off';
    readonly selectors: readonly [];
} | {
    readonly mode: 'selected';
    readonly selectors: NonEmptyReadonlyArray<string>;
};

export type RunTestFamily = 'benchmark' | 'integration' | 'microtest' | 'property' | 'type-test';
export type RunHostProcessReason = RunHostProcessReasonDefinition;

export type WorkUnitMode = WorkUnitModeDefinition;
export type WorkUnitId = WorkUnitIdDefinition;
export type WorkUnitResourceConstraints = WorkUnitResourceConstraintsDefinition;
export type DuplicateExecutionSafety = DuplicateExecutionSafetyDefinition;
export type WorkUnit = WorkUnitDefinition;
export type ExecutorDescriptor = ExecutorDescriptorDefinition;
export type PlacementLane = PlacementLaneDefinition;
export type PlacementAssignment = PlacementAssignmentDefinition;
export type PlacementPlan = PlacementPlanDefinition;
export type DurationHistoryObservation = DurationHistoryObservationDefinition;
export type DurationHistorySample = DurationHistorySampleDefinition;
export type DurationHistoryInput = DurationHistoryInputDefinition;

export const emptyWorkUnitResourceConstraints: WorkUnitResourceConstraints = Object.freeze({
    affinityKeys: Object.freeze([]),
    capacityWeight: 1,
    duplicateExecution: Object.freeze([]),
    faultDomains: Object.freeze([]),
    serialKeys: Object.freeze([]),
    singleWorkerKeys: Object.freeze([])
});

export type ProfileRunRequest<Profile extends string | null> = RunHistoryRequest & {
    readonly baselineUpdateMode: BaselineUpdateMode;
    readonly capabilityRestrictions: RunCapabilityRestrictionsRequest;
    readonly capture: 'buffered' | 'live';
    readonly coverage: boolean;
    readonly debug: RunDebugRequest;
    readonly execution: RunExecutionRequest;
    readonly measureProcessUsage: boolean | null;
    readonly order: RunOrder;
    readonly paths: readonly string[];
    readonly profile: Profile;
    readonly processBudgetOverrides: ProcessBudgets | null;
    readonly processUsageSamplingIntervalMilliseconds: number | null;
    readonly seed: RunSeed;
    readonly selection: RunSelection;
    readonly shard: RunShard;
    readonly timingCollection: TimingCollectionOverride;
    readonly verbose: false;
    readonly workers: number | null;
};

export type RunRequest = ProfileRunRequest<string>;

type OrdinaryRunCommand = {
    readonly config: NormalizedConfig;
    readonly cwd: string;
    readonly engine: RunEngineSelection;
    readonly request: RunRequest;
};
type WitnessRunCommand = OrdinaryRunCommand & { readonly propertyReplay: PropertyCorpusSnapshot['checkedIn'][number]; };
export type RunCommand = OrdinaryRunCommand | WitnessRunCommand;
type ReplayRunFacts = OrdinaryRunFacts & { readonly propertyReplay: PropertyCorpusSnapshot['checkedIn'][number]; };
export type RunFacts = OrdinaryRunFacts | ReplayRunFacts;

type AdapterProfile = Extract<NormalizedConfig['profiles'][string], { readonly testFamily: 'type-test'; }>;
type AdapterBackend = Awaited<ReturnType<AdapterProfile['adapter']['load']>>;
type AdapterPreparation = Awaited<ReturnType<AdapterBackend['prepare']>>;
type AdapterCollection = Awaited<ReturnType<AdapterPreparation['collect']>>;

type OrdinaryRunFacts = {
    readonly adapter: { readonly id: string; readonly facts: AdapterCollection['facts']; } | null;
    readonly benchmarkHost: BenchmarkHostAssessment | null;
    readonly benchmarkPlacement: BenchmarkPlacementFacts | null;
    readonly benchmarkCalibration: BenchmarkCalibrationResult | null;
    readonly benchmarkNormalization: NonNullable<ExecuteDependencies['benchmarkEnvironment']>['normalization'];
    readonly coveragePolicy: CoveragePolicy | null;
    readonly cases: readonly RunCaseFacts[];
    readonly durationHistory: DurationHistoryInput | null;
    readonly environment: RunEnvironmentFacts;
    readonly execution: RunExecutionFacts;
    readonly loader: LoaderConfig;
    readonly reproducibility: RunReproducibilityFacts;
};

export type RunCaseFacts = {
    readonly propertyPolicy: PropertyPolicy | null;
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
    readonly runRecords: RunRecordPersistenceFacts;
    readonly benchmarkGarbageCollection: BenchmarkProfileConfig['garbageCollection'] | null;
    readonly propertyPolicy: PropertyPolicy | null;
    readonly attachments: AttachmentLimits | null;
    readonly retries: IntegrationRetryPolicy | null;
    readonly baselineUpdateMode: BaselineUpdateMode;
    readonly capture: 'buffered' | 'live';
    readonly coverage: boolean;
    readonly debug: RunDebugRequest;
    readonly debuggedCases: readonly WorkId[];
    readonly engine: RunEngineFacts;
    readonly maxConcurrency: MaxConcurrency;
    readonly order: RunOrder;
    readonly placementPlan: PlacementPlan | null;
    readonly profile: string;
    readonly processUsagePolicy: ProcessUsagePolicy;
    readonly scheduling: Scheduling;
    readonly testFamily: RunTestFamily;
    readonly failureArtifacts: ProfileConfig['failureArtifacts'];
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
    readonly skipReason: string | null;
    readonly property: { readonly definition: PropertyBodyDefinition; readonly policy: PropertyPolicy; } | null;
    readonly benchmark: BenchmarkDefinitionSummary | null;
    readonly workloadParameters: TestPlan['cases'][number]['workloadParameters'];
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
    readonly adapter: { readonly preparation: AdapterPreparation; readonly collected: AdapterCollection; };
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

export type RunnerResult = RunResult & { readonly maintenanceDiagnostics: readonly string[]; };
export type RunReporterDeliveryResult = {
    readonly deliveredRunnerErrors: readonly RunResult['runnerErrors'][number][];
    readonly result: RunnerResult;
    readonly undeliveredRunnerErrors: readonly RunResult['runnerErrors'][number][];
};

export type BenchmarkBaselineCommand = Except<RunCommand, 'request'> & {
    readonly request: Except<RunRequest, 'baselineUpdateMode'>;
};

export type BenchmarkBaselineListCommand = Pick<RunCommand, 'config' | 'cwd'> & {
    readonly request: Pick<RunRequest, 'paths' | 'profile'>;
};

export type BenchmarkBaselineRunResult = RunReporterDeliveryResult & {
    readonly calibrationChanges: readonly CalibrationReferenceChange[];
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
    readonly calibrate: (
        command: RunCommand,
        options: RunInvocationTimingOptions
    ) => Promise<RunReporterDeliveryResult>;
    readonly baseline: BenchmarkBaselineOrchestrator;
    readonly list: (command: RunCommand, options: RunInvocationTimingOptions) => Promise<ResolvedRun>;
    readonly run: (command: RunCommand, options: RunInvocationTimingOptions) => Promise<RunnerResult>;
    readonly runWithReporterDelivery: (
        command: RunCommand,
        options: RunInvocationTimingOptions
    ) => Promise<RunReporterDeliveryResult>;
};

export type RunInvocationOptions = RunInvocationTimingOptions & { readonly signal: AbortSignal | null; };
type RunOperation<Command, Result> = (
    command: Command,
    options?: RunInvocationOptions | RunInvocationTimingOptions
) => Promise<Result>;
export type RunOperations<Command> = {
    readonly resolve: (command: Command, options?: RunInvocationTimingOptions) => Promise<ResolvedRun>;
    readonly run: RunOperation<Command, RunnerResult>;
    readonly runWithReporterDelivery: RunOperation<Command, RunReporterDeliveryResult>;
};

export type ConfiguredRunOrchestrator = RunOperations<RunCommand> & {
    readonly bench: BenchmarkOrchestrator;
};

export type InitializedRun = {
    readonly collect: () => Promise<CollectedRun>;
};

export type CollectedRunInvocation = {
    readonly selection: RunSelection;
};

export type CollectedRun = {
    readonly facts: RunFacts;
    readonly plan: CollectedRunPlan;
    readonly run: (invocation: CollectedRunInvocation) => Promise<RunnerResult>;
    readonly runWithReporterDelivery: (invocation: CollectedRunInvocation) => Promise<RunReporterDeliveryResult>;
};

export type RunRuntimeAttachments = AttachmentCoordinator | null;

export type DiscoveredRunFile = {
    readonly file: string;
    readonly fileSet: string | null;
    readonly href: string;
    readonly path: string;
};

export type DiscoveredRunFiles = {
    readonly files: NonEmptyReadonlyArray<DiscoveredRunFile>;
    readonly projectRoot: string;
};

export type RunPolicySource = {
    readonly kind: 'config-file';
    readonly request: ConfigLoadRequest;
    readonly resolvedPath: string | null;
} | {
    readonly kind: 'memory';
};

export type FileModuleBoundary = {
    readonly projectRoot: string;
    readonly sharedRoots: readonly string[];
};

export type FrozenMicrotestPolicy = {
    readonly history: NormalizedConfig['history'];
    readonly moduleBoundary: FileModuleBoundary | null;
    readonly source: RunPolicySource;
    readonly cwd: string;
    readonly projectRoot: string;
    readonly files: NonEmptyReadonlyArray<DiscoveredRunFile>;
    readonly loader: NormalizedConfig['loader'];
    readonly profile: Except<MicrotestProfileConfig, 'baselines' | 'reporters'>;
    readonly request: Except<RunRequest, 'seed'>;
    readonly engine: Exclude<RunEngineSelection, { readonly kind: 'instance'; }>;
    readonly runtimeStateDir: string;
};

export type FreezePolicyInput = {
    readonly moduleBoundary: FileModuleBoundary | null;
    readonly command: RunCommand;
    readonly source: RunPolicySource;
};

export type FrozenRunCommand = {
    readonly kind: 'frozen-policy';
    readonly policy: FrozenMicrotestPolicy;
    readonly invocation: {
        readonly seed: RunSeed;
        readonly selection: RunSelection;
    };
    readonly reporting: Pick<NormalizedConfig, 'outputRenderer' | 'reporters'>;
};

export type DirectEntrypointRunCollectionSource = {
    readonly kind: 'direct-entrypoint';
    readonly root: RunCollectionRoot;
    readonly testNode: Parameters<Engine['createTestPlanFromTestFiles']>[0]['files'][number]['testNode'];
};

export type RunCollectionSource = DirectEntrypointRunCollectionSource | { readonly kind: 'configured-files'; } | {
    readonly kind: 'frozen-policy';
    readonly policy: FrozenMicrotestPolicy;
} | { readonly kind: 'replay'; readonly replay: ReplayWire; };

export type RunSelection = SelectedCases;

export type RunExecutionLifecycle = {
    readonly select: (plan: CollectedRunPlan) => Promise<RunSelection>;
    readonly beforeCases: () => Promise<void>;
    readonly enterCase: (work: WorkId) => Promise<void>;
    readonly completeCase: (result: PerTestResult, errors: readonly RunnerError[]) => Promise<'continue' | 'stop'>;
    readonly snapshot: () => JsonValue;
    readonly dispose: () => Promise<void>;
};

export type RunExecutionLifecycleFactory = (data: JsonValue) => Promise<RunExecutionLifecycle>;
export type RunExecutionSessionOptions = {
    readonly command: FrozenRunCommand;
    readonly lifecycle: RunExecutionLifecycleReference;
    readonly environment: 'fresh-invocation' | 'profile-default';
};

export type ReplayWire = RecordedRunSource<CollectedRunPlan>;

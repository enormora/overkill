import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { SerializedValue as SerializedValueShape } from '../compare/serialized-value.ts';
import type { Execute } from '../engine/execution.ts';
import type { Engine } from '../engine/engine.ts';
import type { OrphanedNode, RunResult } from '../engine/run-result.ts';
import type { TestPlan } from '../engine/test-plan.ts';

export type SerializedValue = SerializedValueShape;
type RunExecuteOptions = NonNullable<Parameters<Execute>[1]>;
type RunCaseId = TestPlan['discoveredCases'][number]['id'];
type RunOutputRenderer = NonNullable<RunExecuteOptions['outputRenderer']>;
type RunReporters = RunExecuteOptions['reporters'];

export type RunStringFilterField = keyof {
    readonly file: true;
    readonly owner: true;
    readonly params: true;
    readonly suite: true;
    readonly tag: true;
    readonly title: true;
};

type RunAllFilter = {
    readonly filters: NonEmptyReadonlyArray<RunFilter>;
    readonly kind: 'all';
};

type RunAnyFilter = {
    readonly filters: NonEmptyReadonlyArray<RunFilter>;
    readonly kind: 'any';
};

type RunCaseIdFilter = {
    readonly id: RunCaseId;
    readonly kind: 'case-id';
};

type RunContainsFilter = {
    readonly field: RunStringFilterField;
    readonly kind: 'contains';
    readonly value: string;
};

type RunEqualsFilter = {
    readonly field: RunStringFilterField;
    readonly kind: 'equals';
    readonly value: string;
};

type RunGlobFilter = {
    readonly field: RunStringFilterField;
    readonly kind: 'glob';
    readonly pattern: string;
};

type RunNotFilter = {
    readonly filter: RunFilter;
    readonly kind: 'not';
};

type RunFilterByKind = {
    readonly all: RunAllFilter;
    readonly any: RunAnyFilter;
    readonly 'case-id': RunCaseIdFilter;
    readonly contains: RunContainsFilter;
    readonly equals: RunEqualsFilter;
    readonly glob: RunGlobFilter;
    readonly not: RunNotFilter;
};

export type RunFilter = RunFilterByKind[keyof RunFilterByKind];

type RunAllSelection = {
    readonly kind: 'all';
};

type RunFilterSelection = {
    readonly filter: RunFilter;
    readonly kind: 'filter';
};

export type RunSelection = RunAllSelection | RunFilterSelection;

export type RunEngineSelection = {
    readonly engine: Engine;
    readonly kind: 'instance';
} | {
    readonly exportKind: 'getter' | 'value';
    readonly exportName: string;
    readonly kind: 'module';
    readonly moduleUrl: string;
} | {
    readonly kind: 'default';
};

export type RunShard = {
    readonly index: number;
    readonly total: number;
};

export type RunExecutionRequest = {
    readonly mode: 'profile-default';
};

type RunCapabilityRestrictionsRequest = {
    readonly mode: 'disabled' | 'enabled';
};

export type RunSeed = {
    readonly value: bigint | null;
};

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

const runProfileNamePattern = /^[A-Za-z0-9._-]+$/u;
const reservedBenchmarkProfileName = 'benchmark';

export type RunTestFamily = 'integration' | 'microtest';

export type RunProcessModel = 'in-process' | 'supervised-process' | 'worker-pool';

export type RunMicrotestProcessModel = Exclude<RunProcessModel, 'worker-pool'>;

export type RunScheduling = 'concurrent' | 'serial';

export type RunWorkerLifecycle = 'fresh-worker-per-unit' | 'reuse';

export type RunWorkerPoolAssignmentPolicy = 'case-count-balanced' | 'stable';

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

type FileRunWorkDistribution = {
    readonly mode: 'file';
};

type CaseRunWorkDistribution = {
    readonly mode: 'case';
};

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

export type RuntimeDimensions = Readonly<Record<string, string>>;

export type RuntimeId = {
    readonly dimensions: RuntimeDimensions;
    readonly name: string;
};

export type WorkloadId = {
    readonly name: string;
    readonly params: Readonly<Record<string, string>>;
};

export type WorkId = {
    readonly case: RunCaseId;
    readonly runtime: RuntimeId | null;
    readonly workload: WorkloadId | null;
};

export type WorkUnitMode = 'case' | 'file' | 'group';

export type WorkUnitId = {
    readonly key: string;
    readonly mode: WorkUnitMode;
    readonly runtime: RuntimeId | null;
    readonly workload: WorkloadId | null;
};

export type WorkUnitResourceConstraints = {
    readonly affinityKeys: readonly string[];
    readonly capacityWeight: number;
    readonly faultDomains: readonly string[];
    readonly serialKeys: readonly string[];
    readonly singleWorkerKeys: readonly string[];
};

export const emptyWorkUnitResourceConstraints: WorkUnitResourceConstraints = Object.freeze({
    affinityKeys: Object.freeze([]),
    capacityWeight: 1,
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
    readonly units: readonly WorkUnit[];
};

export type PlacementTrace = {
    readonly entries: readonly PlacementTraceEntry[];
};

export type PlacementTraceEntry = {
    readonly activeUnit: WorkUnitId | null;
    readonly kind: 'worker-crashed';
    readonly workerId: string;
} | {
    readonly durationMilliseconds: number;
    readonly kind: 'unit-completed';
    readonly unit: WorkUnitId;
    readonly workerId: string;
} | {
    readonly fromLane: PlacementLane['id'];
    readonly kind: 'unit-reassigned';
    readonly toLane: PlacementLane['id'];
    readonly unit: WorkUnitId;
} | {
    readonly kind: 'hedged-duplicate-discarded';
    readonly unit: WorkUnitId;
    readonly workerId: string;
} | {
    readonly kind: 'hedged-duplicate-started';
    readonly unit: WorkUnitId;
    readonly workerId: string;
} | {
    readonly kind: 'unit-started';
    readonly lane: PlacementLane['id'];
    readonly unit: WorkUnitId;
    readonly workerId: string;
};

export type RunMicrotestExecution = {
    readonly processModel: RunMicrotestProcessModel;
    readonly scheduling: RunScheduling;
};

type RunSupervisedIntegrationExecution = {
    readonly processModel: 'supervised-process';
    readonly scheduling: RunScheduling;
};

type RunWorkerPoolExecution = {
    readonly assignmentPolicy: RunWorkerPoolAssignmentPolicy;
    readonly hostProcess: RunHostProcess;
    readonly processModel: 'worker-pool';
    readonly scheduling: RunScheduling;
    readonly workDistribution: RunWorkDistribution;
    readonly workerLifecycle: RunWorkerLifecycle;
};

export type RunIntegrationExecution = RunSupervisedIntegrationExecution | RunWorkerPoolExecution;

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
    readonly execution: RunMicrotestExecution;
    readonly files: RunProfileFiles | null;
    readonly reporters: RunReporters | null;
    readonly resourceUsage: RunResourceUsagePolicy;
    readonly testFamily: 'microtest';
    readonly timeouts: RunTimeoutPolicy;
};

export type RunIntegrationProfileConfig = {
    readonly execution: RunIntegrationExecution;
    readonly files: RunProfileFiles;
    readonly reporters: RunReporters | null;
    readonly resourceUsage: RunResourceUsagePolicy;
    readonly testFamily: 'integration';
    readonly timeouts: RunTimeoutPolicy;
};

export type RunProfileConfig = RunIntegrationProfileConfig | RunMicrotestProfileConfig;

export type RunProfilesConfig = Readonly<Record<string, RunProfileConfig>>;

export type RunConfig = {
    readonly loader: RunLoaderConfig;
    readonly outputRenderer: RunOutputRenderer;
    readonly profiles: RunProfilesConfig;
    readonly reporters: RunReporters;
    readonly runtimeStateDir: string;
};

export type RunOrder = 'lexical' | 'plan' | 'seeded';

export type RunRequest = {
    readonly baselineUpdateMode: 'none';
    readonly capabilityRestrictions: RunCapabilityRestrictionsRequest;
    readonly capture: 'buffered' | 'live';
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
    readonly verbose: false;
};

export type RunCommand = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunEngineSelection;
    readonly request: RunRequest;
};

export type RunFacts = {
    readonly cases: readonly RunCaseFacts[];
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
    readonly baselineUpdateMode: 'none';
    readonly capture: 'buffered' | 'live';
    readonly debug: RunDebugRequest;
    readonly engine: RunEngineFacts;
    readonly order: RunOrder;
    readonly placementPlan: PlacementPlan | null;
    readonly profile: string;
    readonly resourceUsagePolicy: RunResourceUsagePolicy;
    readonly scheduling: RunScheduling;
    readonly testFamily: RunTestFamily;
    readonly timeoutPolicy: RunTimeoutPolicy;
    readonly verbose: false;
};

type RunWorkerPoolExecutionFacts = RunExecutionBaseFacts & {
    readonly assignmentPolicy: RunWorkerPoolAssignmentPolicy;
    readonly hostProcess: RunHostProcessFacts;
    readonly processModel: 'worker-pool';
    readonly workDistribution: RunWorkDistribution;
    readonly workerLifecycle: RunWorkerLifecycle;
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

export type CollectedRunCase = {
    readonly annotations: TestPlan['cases'][number]['annotations'];
    readonly controls: TestPlan['cases'][number]['controls'];
    readonly definitionLocations: TestPlan['cases'][number]['definitionLocations'];
    readonly params: string | null;
    readonly resourceAttachments: TestPlan['cases'][number]['resourceAttachments'];
    readonly suitePath: TestPlan['cases'][number]['suitePath'];
    readonly testFamily: TestPlan['cases'][number]['testFamily'];
    readonly title: string;
};

export type CollectedRunFile = {
    readonly cases: readonly CollectedRunCase[];
    readonly file: string;
};

export type CollectedRunPlan = {
    readonly defined: number;
    readonly discoveredFiles: readonly CollectedRunFile[];
    readonly files: readonly CollectedRunFile[];
    readonly orphans: readonly OrphanedNode[];
    readonly root: {
        readonly annotations: TestPlan['root']['annotations'];
        readonly controls: TestPlan['root']['controls'];
        readonly title: string;
    };
};

export type ResolvedRunPlan = {
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
    readonly resolve: (command: RunCommand) => Promise<ResolvedRun>;
    readonly run: (command: RunCommand) => Promise<RunResult>;
    readonly runWithReporterDelivery: (command: RunCommand) => Promise<{
        readonly deliveredRunnerErrors: readonly RunResult['runnerErrors'][number][];
        readonly result: RunResult;
    }>;
};

export function invalidRunProfileNameMessage(profileName: string): string | null {
    if (!runProfileNamePattern.test(profileName)) {
        return `Invalid profile name "${profileName}". ` +
            'Profile names may only contain letters, numbers, dots, underscores, and hyphens.';
    }

    if (profileName === reservedBenchmarkProfileName) {
        return 'Invalid profile name "benchmark". The "benchmark" profile name is reserved for benchmark commands.';
    }

    return null;
}

export function invalidRunProfileFileSetNameMessage(fileSetName: string): string | null {
    if (!runProfileNamePattern.test(fileSetName)) {
        return `Invalid profile file set name "${fileSetName}". ` +
            'Profile file set names may only contain letters, numbers, dots, underscores, and hyphens.';
    }

    return null;
}

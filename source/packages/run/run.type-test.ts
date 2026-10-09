import { describe, expect, test } from 'tstyche';
import type {
    AttachmentLimits,
    DefinedOutputRenderer,
    DefinedReporter,
    RunResult,
    TestAnnotationsInput,
    TestControlsInput
} from '../engine/engine.entry-point.ts';
import {
    ConfigError,
    RunResolutionError,
    type TestProfileConfig,
    type defineConfig,
    type DynamicWorkUnitId,
    type loadConfig,
    type LoadedConfig,
    type orchestrator,
    type PlacementPlan,
    type PlacementTrace,
    type ResolvedRun,
    type RunCommand,
    type NormalizedConfig,
    type ConfigLoadRequest,
    type RunEngineSelection,
    type RunExecutionFacts,
    type RunExecutionPlanError,
    type RunExecutionPlanConflict,
    type RunFacts,
    type RunIfMain,
    type RunIfMainOptions,
    type RunIfMainRootOptions,
    type HostProcess,
    type RunHostProcessFacts,
    type RunHostProcessReason,
    type RunInvocationTimingOptions,
    type runIfMain,
    type IntegrationExecution,
    type IntegrationProfileConfig,
    type MaxConcurrency,
    type MicrotestExecution,
    type RunSelection,
    type MicrotestProfileConfig,
    type RunOrder,
    type RunOrchestrator,
    type ProcessModel,
    type ProfileConfig,
    type BenchmarkProfileConfig,
    type BenchmarkOrchestrator,
    type RunReporterDeliveryResult,
    type ProfileFiles,
    type Config,
    type ProjectIntegrationProfileConfig,
    type ProjectIntegrationExecution,
    type ProjectProfileFiles,
    type ProjectMicrotestProfileConfig,
    type ProjectMicrotestExecution,
    type ProjectProfileConfig,
    type ProjectBenchmarkProfileConfig,
    type ResourceBudgets,
    type ResourceUsagePolicy,
    type ResourceOwnershipPlan,
    type RunRequest,
    type Scheduling,
    type RunTestFamily,
    type ProjectTimingProfilePolicy,
    type TimingCollectionMode,
    type TimingCollectionOverride,
    type TimingProfilePolicy,
    type WorkDistribution,
    type WorkGroup,
    type WorkGroupGranularity,
    type WorkGroupOrder,
    type WorkGroupScheduling,
    type WorkGroupWorkerLifecycle,
    type WorkerPoolAssignmentPolicy,
    type WorkerPoolDispatchPolicy,
    type WorkerLifecycle,
    type RunWorkerCountFacts,
    type RuntimeId,
    type TraceWorkUnitId,
    type WorkloadId,
    type WorkId,
    type WorkUnit,
    type WorkUnitId,
    type WorkUnitMode
} from './run.entry-point.ts';

declare const outputRenderer: DefinedOutputRenderer;
declare const reporter: DefinedReporter;
declare const testNode: Parameters<RunIfMain>[1];

type RunRequestKeys = readonly [
    'baselineUpdateMode',
    'capabilityRestrictions',
    'capture',
    'coverage',
    'debug',
    'execution',
    'measureResourceUsage',
    'order',
    'paths',
    'profile',
    'resourceBudgetOverrides',
    'resourceUsageSamplingIntervalMilliseconds',
    'seed',
    'selection',
    'shard',
    'timingCollection',
    'verbose',
    'workers'
];

type ExpectedRunRequestKey = RunRequestKeys[number];
type RuntimeProfileFilePatterns = {
    readonly exclude: readonly string[];
    readonly include: readonly [string, ...readonly string[]];
};
type RuntimeProfileFileSets = {
    readonly sets: Readonly<
        Record<string, {
            readonly exclude: readonly string[];
            readonly include: readonly [string, ...readonly string[]];
        }>
    >;
};
type MixedRuntimeProfileFiles = RuntimeProfileFilePatterns & RuntimeProfileFileSets;
type ProjectProfileFilePatterns = {
    readonly exclude?: readonly string[];
    readonly include: readonly [string, ...readonly string[]];
};
type ProjectProfileFileSets = {
    readonly sets: Readonly<
        Record<string, {
            readonly exclude?: readonly string[];
            readonly include: readonly [string, ...readonly string[]];
        }>
    >;
};
type ExpectedPlacementTraceKinds = {
    readonly 'attempt-assigned': true;
    readonly 'attempt-completed': true;
    readonly 'attempt-interrupted': true;
    readonly 'attempt-started': true;
    readonly 'batch-completed': true;
    readonly 'batch-started': true;
    readonly 'hedge-conflict': true;
    readonly 'hedge-resolved': true;
    readonly 'recovery-decided': true;
    readonly 'unit-split': true;
    readonly 'warm-lane-affinity-selected': true;
    readonly 'worker-crashed': true;
};
type ExpectedRunWorkDistribution = {
    readonly groups: readonly [WorkGroup, ...readonly WorkGroup[]];
    readonly mode: 'group';
    readonly unmatched: 'file' | 'reject';
} | {
    readonly mode: 'case';
} | {
    readonly mode: 'file';
};
type ExpectedRunHostProcess = {
    readonly kind: 'child';
    readonly nodeArguments: readonly string[];
} | {
    readonly kind: 'direct';
};
type ExpectedRunHostProcessFacts = {
    readonly kind: 'child';
    readonly nodeArguments: readonly string[];
    readonly reasons: readonly [RunHostProcessReason, ...readonly RunHostProcessReason[]];
} | {
    readonly kind: 'direct';
};

function assertOrchestratorTypes(): void {
    expect<typeof orchestrator>().type.toBe<RunOrchestrator>();
    expect<typeof orchestrator.bench>().type.toBe<BenchmarkOrchestrator>();
    expect<typeof orchestrator.bench.list>().type.toBe<
        (command: RunCommand, options: RunInvocationTimingOptions) => Promise<ResolvedRun>
    >();
    expect<typeof orchestrator.bench.run>().type.toBe<
        (command: RunCommand, options: RunInvocationTimingOptions) => Promise<RunResult>
    >();
    expect<typeof orchestrator.bench.runWithReporterDelivery>().type.toBe<
        (command: RunCommand, options: RunInvocationTimingOptions) => Promise<RunReporterDeliveryResult>
    >();
    expect<typeof orchestrator.resolve>().type.toBe<
        (command: RunCommand, options?: RunInvocationTimingOptions) => Promise<ResolvedRun>
    >();
    expect<typeof orchestrator.run>().type.toBe<
        (command: RunCommand, options?: RunInvocationTimingOptions) => Promise<RunResult>
    >();
}

function assertWorkIdentityTypes(): void {
    expect<RuntimeId['scenarios']>().type.toBe<Readonly<Record<string, string>>>();
    expect<WorkId['runtimes']>().type.toBe<readonly RuntimeId[]>();
    expect<WorkId['workload']>().type.toBe<WorkloadId | null>();
}

describe('@overkill-dev/run', function () {
    test('exposes the typed run command surface', function () {
        expect<keyof RunCommand>().type.toBe<'config' | 'cwd' | 'engine' | 'request'>();
        expect<RunCommand['config']>().type.toBe<NormalizedConfig>();
        expect<RunCommand['cwd']>().type.toBe<string>();
        expect<RunCommand['engine']>().type.toBe<RunEngineSelection>();
        expect<RunCommand['request']>().type.toBe<RunRequest>();
        assertOrchestratorTypes();
    });

    test('exposes the direct-file execution companion', function () {
        expect<typeof runIfMain>().type.toBe<RunIfMain>();
        expect<RunIfMainOptions>().type.toBe<{
            readonly outputRenderer?: DefinedOutputRenderer;
            readonly reporters?: readonly DefinedReporter[];
            readonly root?: RunIfMainRootOptions;
        }>();
        expect<RunIfMainRootOptions>().type.toBe<{
            readonly annotations?: TestAnnotationsInput;
            readonly controls?: TestControlsInput;
            readonly title: string;
        }>();
        expect<typeof runIfMain>().type.toBeCallableWith(import.meta, testNode);
        expect<typeof runIfMain>().type.toBeCallableWith(import.meta, testNode, {
            outputRenderer,
            reporters: [ reporter ],
            root: {
                annotations: {},
                controls: {},
                title: 'root'
            }
        });
        expect<typeof runIfMain>().type.not.toBeCallableWith(import.meta, testNode, { runFacts: {} });
        expect<typeof runIfMain>().type.not.toBeCallableWith(import.meta, testNode, { profile: 'microtest' });
        expect<typeof runIfMain>().type.not.toBeCallableWith(import.meta, testNode, { cwd: 'project' });
    });

    test('keeps request fields explicit for the implemented runner slice', function () {
        expect<keyof RunRequest>().type.toBe<ExpectedRunRequestKey>();
        expect<RunRequest['capabilityRestrictions']['mode']>().type.toBe<'disabled' | 'enabled'>();
        expect<RunRequest['execution']['mode']>().type.toBe<'profile-default'>();
        expect<RunRequest['measureResourceUsage']>().type.toBe<boolean | null>();
        expect<RunRequest['profile']>().type.toBe<string>();
        expect<RunRequest['resourceBudgetOverrides']>().type.toBe<ResourceBudgets | null>();
        expect<RunRequest['timingCollection']>().type.toBe<TimingCollectionOverride>();
        expect<Pick<RunRequest, 'capture' | 'coverage' | 'order'>>().type.toBe<{
            readonly capture: 'buffered' | 'live';
            readonly coverage: boolean;
            readonly order: RunOrder;
        }>();
        expect<RunOrder>().type.toBe<'lexical' | 'plan' | 'seeded'>();
        expect<RunRequest['selection']>().type.toBe<RunSelection>();
    });

    test('exposes serializable run execution facts', function () {
        expect<RunExecutionFacts['engine']['kind']>().type.toBe<'default' | 'instance' | 'module'>();
        expect<RunExecutionFacts['capture']>().type.toBe<'buffered' | 'live'>();
        expect<RunExecutionFacts['coverage']>().type.toBe<boolean>();
        expect<RunExecutionFacts['maxConcurrency']>().type.toBe<MaxConcurrency>();
        expect<RunExecutionFacts['processModel']>().type.toBe<ProcessModel>();
        expect<RunExecutionFacts['placementPlan']>().type.toBe<PlacementPlan | null>();
        expect<RunExecutionFacts['profile']>().type.toBe<string>();
        expect<RunExecutionFacts['resourceUsagePolicy']>().type.toBe<ResourceUsagePolicy>();
        expect<RunExecutionFacts['timingCollection']>().type.toBe<TimingCollectionMode>();
    });

    test('exposes case file set facts', function () {
        expect<RunFacts['cases'][number]['fileSet']>().type.toBe<string | null>();
    });

    test('exposes run scheduling and family facts', function () {
        expect<RunExecutionFacts['scheduling']>().type.toBe<Scheduling>();
        expect<RunExecutionFacts['testFamily']>().type.toBe<RunTestFamily>();
        expect<
            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['workerLifecycle']
        >()
            .type
            .toBe<WorkerLifecycle>();
        expect<
            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['workDistribution']
        >()
            .type
            .toBe<WorkDistribution>();
        expect<
            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['hostProcess']
        >()
            .type
            .toBe<RunHostProcessFacts>();
        expect<HostProcess>().type.toBe<ExpectedRunHostProcess>();
        expect<RunHostProcessFacts>().type.toBe<ExpectedRunHostProcessFacts>();
        expect<RunHostProcessReason>().type.toBe<
            keyof {
                readonly 'benchmark-isolation': true;
                readonly debugging: true;
                readonly 'forced-garbage-collection': true;
                readonly 'host-isolation': true;
                readonly 'node-arguments': true;
                readonly profiling: true;
            }
        >();
        expect<WorkDistribution>().type.toBe<ExpectedRunWorkDistribution>();
        expect<WorkGroup>().type.toBe<{
            readonly fileSets: readonly [string, ...readonly string[]];
            readonly granularity: WorkGroupGranularity;
            readonly name: string;
            readonly order: WorkGroupOrder;
            readonly scheduling: WorkGroupScheduling;
            readonly workerLifecycle: WorkGroupWorkerLifecycle;
        }>();
    });

    test('exposes worker-pool placement facts', function () {
        expect<
            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['placementPlan']
        >()
            .type
            .toBe<PlacementPlan | null>();
        expect<
            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['dispatchPolicy']
        >()
            .type
            .toBe<WorkerPoolDispatchPolicy>();
    });

    test('exposes work-unit planning types', function () {
        assertWorkIdentityTypes();
        expect<WorkUnit['work']>().type.toBe<readonly [WorkId, ...readonly WorkId[]]>();
        expect<WorkUnit['id']['mode']>().type.toBe<WorkUnitMode>();
        expect<WorkUnit['order']>().type.toBe<RunOrder>();
        expect<WorkUnit['scheduling']>().type.toBe<Scheduling>();
        expect<WorkUnit['workerLifecycle']>().type.toBe<WorkerLifecycle>();
        expect<PlacementPlan['lanes'][number]['executor']['kind']>().type.toBe<
            'browser' | 'local-process' | 'local-worker' | 'remote'
        >();
        expect<PlacementPlan['assignments'][number]['unit']>().type.toBe<WorkUnit['id']>();
        expect<PlacementPlan['resourceOwnership']>().type.toBe<ResourceOwnershipPlan>();
    });

    test('exposes placement trace entry kinds', function () {
        expect<Readonly<Record<PlacementTrace['entries'][number]['kind'], true>>>().type.toBe<
            ExpectedPlacementTraceKinds
        >();
        expect<DynamicWorkUnitId>().type.toBe<{
            readonly child: string;
            readonly parent: WorkUnitId;
        }>();
        expect<TraceWorkUnitId>().type.toBe<DynamicWorkUnitId | WorkUnitId>();
    });
});

test('exposes timing collection request types', function () {
    expect<TimingCollectionOverride>().type.toBe<'precise' | 'profile-default'>();
    expect<TimingCollectionMode>().type.toBe<'precise' | 'summary'>();
});

describe('@overkill-dev/run worker-pool placement', function () {
    test('exposes worker-count requests', function () {
        expect<RunRequest['workers']>().type.toBe<number | null>();
    });

    test('exposes resolved worker-count facts', function () {
        expect<
            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['workerCount']
        >()
            .type
            .toBe<RunWorkerCountFacts>();
        expect<RunWorkerCountFacts>().type.toBe<{
            readonly hostMaximum: number;
            readonly profileMaximum: number | null;
            readonly requested: number | null;
            readonly resolved: number;
        }>();
    });

    test('exposes worker-pool profile maximums', function () {
        expect<ProjectIntegrationProfileConfig>().type.toBeAssignableFrom<{
            readonly execution: {
                readonly maxWorkers: number;
                readonly processModel: 'worker-pool';
            };
            readonly files: ProjectProfileFiles;
            readonly testFamily: 'integration';
        }>();
    });

    test('exposes per-executor concurrency limits', function () {
        expect<MaxConcurrency>().type.toBe<number | 'unlimited'>();
        expect<MicrotestExecution['maxConcurrency']>().type.toBe<MaxConcurrency>();
        expect<IntegrationExecution['maxConcurrency']>().type.toBe<MaxConcurrency>();
        expect<ProjectMicrotestExecution>().type.toBeAssignableFrom<{
            readonly maxConcurrency: 'unlimited';
            readonly processModel: 'in-process';
        }>();
        expect<ProjectIntegrationExecution>().type.toBeAssignableFrom<{
            readonly maxConcurrency: 'unlimited';
            readonly processModel: 'worker-pool';
        }>();
    });

    test('exposes worker-pool assignment policy facts', function () {
        expect<
            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['assignmentPolicy']
        >()
            .type
            .toBe<WorkerPoolAssignmentPolicy>();
        expect<WorkerPoolAssignmentPolicy>()
            .type
            .toBe<'case-count-balanced' | 'duration-history-balanced' | 'stable'>();
        expect<WorkerPoolDispatchPolicy>()
            .type
            .toBe<'dynamic-lease' | 'static-assignment'>();
    });
});

describe('@overkill-dev/run config', function () {
    test('exposes collection, soft, and hard timeout facts', function () {
        expect<RunExecutionFacts['timeoutPolicy']['collectionMilliseconds']>().type.toBe<number>();
        expect<RunExecutionFacts['timeoutPolicy']['hardMilliseconds']>().type.toBe<number>();
        expect<RunExecutionFacts['timeoutPolicy']['softMilliseconds']>().type.toBe<number>();
    });

    test('exposes config and resolution errors', function () {
        expect<keyof NormalizedConfig>().type.toBe<
            'loader' | 'outputRenderer' | 'profiles' | 'reporters' | 'runtimeStateDir'
        >();
        expect<NormalizedConfig['outputRenderer']>().type.toBe<DefinedOutputRenderer>();
        expect<NormalizedConfig['profiles'][string]>().type.toBe<ProfileConfig>();
        expect<ProfileConfig>().type.toBe<BenchmarkProfileConfig | IntegrationProfileConfig | MicrotestProfileConfig>();
        expect<NormalizedConfig['profiles']['backend-http']>().type.toBe<ProfileConfig>();
        expect<NormalizedConfig['reporters']>().type.toBe<readonly DefinedReporter[] | null>();
        expect<TestProfileConfig['timings']>().type.toBe<TimingProfilePolicy>();
        expect<TimingProfilePolicy>().type.toBe<{ readonly collection: TimingCollectionMode; }>();
        expect<ProjectTimingProfilePolicy>().type.toBe<{ readonly collection: TimingCollectionMode; }>();
    });

    test('exposes run resource budget and resolution error types', function () {
        expect<keyof ResourceBudgets>().type.toBe<
            'activeResourceCount' | 'javaScriptEngineHeapBytes' | 'residentSetBytes' | 'residentSetGrowthBytesPerSecond'
        >();
        expect(new RunResolutionError('Unsupported.', undefined, 'unsupported-request')).type.toBe<
            RunResolutionError
        >();
        expect<ReturnType<RunExecutionPlanError['conflicts']>>().type.toBe<
            readonly [RunExecutionPlanConflict, ...readonly RunExecutionPlanConflict[]]
        >();
    });

    test('exposes profile file discovery types', function () {
        expect<MicrotestProfileConfig['files']>().type.toBe<ProfileFiles | null>();
        expect<IntegrationProfileConfig['files']>().type.toBe<ProfileFiles>();
        expect<ProfileFiles>().type.toBeAssignableFrom<RuntimeProfileFilePatterns>();
        expect<ProfileFiles>().type.toBeAssignableFrom<RuntimeProfileFileSets>();
        expect<ProfileFiles>().type.not.toBeAssignableFrom<MixedRuntimeProfileFiles>();
        expect<ProjectMicrotestProfileConfig['files']>().type.toBe<ProjectProfileFiles | undefined>();
        expect<ProjectIntegrationProfileConfig['files']>().type.toBe<ProjectProfileFiles>();
        expect<ProjectProfileFiles>().type.toBeAssignableFrom<ProjectProfileFilePatterns>();
        expect<ProjectProfileFiles>().type.toBeAssignableFrom<ProjectProfileFileSets>();
    });

    test('exposes config loading helpers from the main package surface', function () {
        expect<typeof defineConfig>().type.toBe<(config: Config) => Config>();
        expect<typeof loadConfig>().type.toBe<
            (request: ConfigLoadRequest) => Promise<LoadedConfig>
        >();
        expect<Config['outputRenderer']>().type.toBe<DefinedOutputRenderer | undefined>();
        expect<Config['reporters']>().type.toBe<
            readonly [DefinedReporter, ...DefinedReporter[]] | undefined
        >();
        expect<ProjectProfileConfig>().type.toBe<
            ProjectBenchmarkProfileConfig | ProjectIntegrationProfileConfig | ProjectMicrotestProfileConfig
        >();
        expect<ProjectProfileConfig>().type.toBeAssignableFrom<{
            readonly execution: ProjectMicrotestProfileConfig['execution'];
            readonly testFamily: 'microtest';
        }>();
        expect<ProjectProfileConfig>().type.toBeAssignableFrom<{
            readonly files: ProjectProfileFiles;
            readonly testFamily: 'integration';
        }>();
        expect<IntegrationProfileConfig>().type.toBeAssignableFrom<{
            readonly attachments: AttachmentLimits;
            readonly retries: null;
            readonly execution: {
                readonly hostProcess: { readonly kind: 'child'; readonly nodeArguments: readonly string[]; };
                readonly processModel: 'worker-pool';
                readonly scheduling: 'concurrent';
                readonly assignmentPolicy: 'case-count-balanced';
                readonly dispatchPolicy: 'dynamic-lease';
                readonly hedging: { readonly mode: 'off'; };
                readonly maxConcurrency: MaxConcurrency;
                readonly maxWorkers: null;
                readonly workDistribution: { readonly mode: 'file'; };
                readonly workerLifecycle: 'reuse';
            };
            readonly files: ProfileFiles;
            readonly reporters: null;
            readonly resourceUsage: ResourceUsagePolicy;
            readonly testFamily: 'integration';
            readonly timings: TimingProfilePolicy;
            readonly timeouts: RunExecutionFacts['timeoutPolicy'];
        }>();
        expect<ProjectIntegrationProfileConfig>().type.not.toBeAssignableFrom<{
            readonly execution: {
                readonly hostProcess: { readonly kind: 'child'; readonly nodeArguments: readonly string[]; };
                readonly processModel: 'worker-pool';
            };
            readonly files: ProjectProfileFiles;
            readonly testFamily: 'integration';
        }>();
        expect(new ConfigError('Invalid config.')).type.toBe<ConfigError>();
    });
});

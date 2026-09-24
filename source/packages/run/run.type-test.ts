import { describe, expect, test } from 'tstyche';
import type {
    DefinedOutputRenderer,
    DefinedReporter,
    RunResult,
    TestAnnotationsInput,
    TestControlsInput
} from '../engine/engine.entry-point.ts';
import {
    RunConfigError,
    RunResolutionError,
    type defineConfig,
    type DynamicWorkUnitId,
    type loadRunConfig,
    type LoadedRunConfig,
    type orchestrator,
    type PlacementPlan,
    type PlacementTrace,
    type ResolvedRun,
    type RunCommand,
    type RunConfig,
    type RunConfigLoadRequest,
    type RunEngineSelection,
    type RunExecutionFacts,
    type RunFacts,
    type RunIfMain,
    type RunIfMainOptions,
    type RunIfMainRootOptions,
    type RunHostProcess,
    type RunHostProcessFacts,
    type RunHostProcessReason,
    type runIfMain,
    type RunIntegrationProfileConfig,
    type RunSelection,
    type RunMicrotestProfileConfig,
    type RunOrder,
    type RunOrchestrator,
    type RunProcessModel,
    type RunProfileConfig,
    type RunProfileFiles,
    type RunProjectConfig,
    type RunProjectIntegrationProfileConfig,
    type RunProjectProfileFiles,
    type RunProjectMicrotestProfileConfig,
    type RunProjectProfileConfig,
    type RunResourceBudgets,
    type RunResourceUsagePolicy,
    type RunRequest,
    type RunScheduling,
    type RunTestFamily,
    type RunProjectTimingProfilePolicy,
    type TimingCollectionMode,
    type TimingCollectionOverride,
    type TimingProfilePolicy,
    type RunWorkDistribution,
    type RunWorkGroup,
    type RunWorkGroupGranularity,
    type RunWorkGroupOrder,
    type RunWorkGroupScheduling,
    type RunWorkGroupWorkerLifecycle,
    type RunWorkerPoolAssignmentPolicy,
    type RunWorkerPoolDispatchPolicy,
    type RunWorkerLifecycle,
    type RuntimeId,
    type SerializedValue,
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
    'verbose'
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
    readonly 'batch-completed': true;
    readonly 'batch-started': true;
    readonly 'hedged-duplicate-conflict': true;
    readonly 'hedged-duplicate-discarded': true;
    readonly 'hedged-duplicate-started': true;
    readonly 'unit-completed': true;
    readonly 'unit-reassigned': true;
    readonly 'unit-split': true;
    readonly 'unit-started': true;
    readonly 'warm-lane-affinity-selected': true;
    readonly 'worker-crashed': true;
};
type ExpectedRunWorkDistribution = {
    readonly groups: readonly [RunWorkGroup, ...readonly RunWorkGroup[]];
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

describe('@overkill-dev/run', function () {
    test('exposes the typed run command surface', function () {
        expect<keyof RunCommand>().type.toBe<'config' | 'cwd' | 'engine' | 'request'>();
        expect<RunCommand['config']>().type.toBe<RunConfig>();
        expect<RunCommand['cwd']>().type.toBe<string>();
        expect<RunCommand['engine']>().type.toBe<RunEngineSelection>();
        expect<RunCommand['request']>().type.toBe<RunRequest>();
        expect<typeof orchestrator>().type.toBe<RunOrchestrator>();
        expect<typeof orchestrator.resolve>().type.toBe<(command: RunCommand) => Promise<ResolvedRun>>();
        expect<typeof orchestrator.run>().type.toBe<(command: RunCommand) => Promise<RunResult>>();
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
        expect<RunRequest['resourceBudgetOverrides']>().type.toBe<RunResourceBudgets | null>();
        expect<RunRequest['timingCollection']>().type.toBe<TimingCollectionOverride>();
        expect<Pick<RunRequest, 'capture' | 'order'>>().type.toBe<{
            readonly capture: 'buffered' | 'live';
            readonly order: RunOrder;
        }>();
        expect<RunOrder>().type.toBe<'lexical' | 'plan' | 'seeded'>();
        expect<RunRequest['selection']>().type.toBe<RunSelection>();
    });

    test('exposes serializable run facts with case annotations and controls', function () {
        expect<keyof RunFacts>()
            .type
            .toBe<'cases' | 'durationHistory' | 'environment' | 'execution' | 'loader' | 'reproducibility'>();
        expect<RunFacts['cases'][number]['annotations']>().type.toBe<SerializedValue>();
        expect<RunFacts['cases'][number]['controls']>().type.toBe<SerializedValue>();
        expect<RunFacts['reproducibility']['selection']>().type.toBe<RunSelection>();
        expect<RunFacts>().type.toBeAssignableTo<Readonly<Record<string, unknown>>>();
    });

    test('exposes serializable run execution facts', function () {
        expect<RunExecutionFacts['engine']['kind']>().type.toBe<'default' | 'instance' | 'module'>();
        expect<RunExecutionFacts['capture']>().type.toBe<'buffered' | 'live'>();
        expect<RunExecutionFacts['processModel']>().type.toBe<RunProcessModel>();
        expect<RunExecutionFacts['placementPlan']>().type.toBe<PlacementPlan | null>();
        expect<RunExecutionFacts['profile']>().type.toBe<string>();
        expect<RunExecutionFacts['resourceUsagePolicy']>().type.toBe<RunResourceUsagePolicy>();
        expect<RunExecutionFacts['timingCollection']>().type.toBe<TimingCollectionMode>();
    });

    test('exposes case file set facts', function () {
        expect<RunFacts['cases'][number]['fileSet']>().type.toBe<string | null>();
    });

    test('exposes run scheduling and family facts', function () {
        expect<RunExecutionFacts['scheduling']>().type.toBe<RunScheduling>();
        expect<RunExecutionFacts['testFamily']>().type.toBe<RunTestFamily>();
        expect<
            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['workerLifecycle']
        >()
            .type
            .toBe<RunWorkerLifecycle>();
        expect<
            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['workDistribution']
        >()
            .type
            .toBe<RunWorkDistribution>();
        expect<
            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['hostProcess']
        >()
            .type
            .toBe<RunHostProcessFacts>();
        expect<RunHostProcess>().type.toBe<ExpectedRunHostProcess>();
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
        expect<RunWorkDistribution>().type.toBe<ExpectedRunWorkDistribution>();
        expect<RunWorkGroup>().type.toBe<{
            readonly fileSets: readonly [string, ...readonly string[]];
            readonly granularity: RunWorkGroupGranularity;
            readonly name: string;
            readonly order: RunWorkGroupOrder;
            readonly scheduling: RunWorkGroupScheduling;
            readonly workerLifecycle: RunWorkGroupWorkerLifecycle;
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
            .toBe<RunWorkerPoolDispatchPolicy>();
    });

    test('exposes work-unit planning types', function () {
        expect<WorkId['runtimes']>().type.toBe<readonly RuntimeId[]>();
        expect<WorkId['workload']>().type.toBe<WorkloadId | null>();
        expect<WorkUnit['work']>().type.toBe<readonly [WorkId, ...readonly WorkId[]]>();
        expect<WorkUnit['id']['mode']>().type.toBe<WorkUnitMode>();
        expect<WorkUnit['order']>().type.toBe<RunOrder>();
        expect<WorkUnit['scheduling']>().type.toBe<RunScheduling>();
        expect<WorkUnit['workerLifecycle']>().type.toBe<RunWorkerLifecycle>();
        expect<PlacementPlan['lanes'][number]['executor']['kind']>().type.toBe<
            'browser' | 'local-process' | 'local-worker' | 'remote'
        >();
        expect<PlacementPlan['assignments'][number]['unit']>().type.toBe<WorkUnit['id']>();
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
    test('exposes worker-pool assignment policy facts', function () {
        expect<
            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['assignmentPolicy']
        >()
            .type
            .toBe<RunWorkerPoolAssignmentPolicy>();
        expect<RunWorkerPoolAssignmentPolicy>()
            .type
            .toBe<'case-count-balanced' | 'duration-history-balanced' | 'stable'>();
        expect<RunWorkerPoolDispatchPolicy>()
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
        expect<keyof RunConfig>().type.toBe<
            'loader' | 'outputRenderer' | 'profiles' | 'reporters' | 'runtimeStateDir'
        >();
        expect<RunConfig['outputRenderer']>().type.toBe<DefinedOutputRenderer>();
        expect<RunConfig['profiles'][string]>().type.toBe<RunProfileConfig>();
        expect<RunProfileConfig>().type.toBe<RunIntegrationProfileConfig | RunMicrotestProfileConfig>();
        expect<RunConfig['profiles']['backend-http']>().type.toBe<RunProfileConfig>();
        expect<RunConfig['reporters']>().type.toBe<readonly DefinedReporter[]>();
        expect<RunProfileConfig['timings']>().type.toBe<TimingProfilePolicy>();
        expect<TimingProfilePolicy>().type.toBe<{ readonly collection: TimingCollectionMode; }>();
        expect<RunProjectTimingProfilePolicy>().type.toBe<{ readonly collection: TimingCollectionMode; }>();
    });

    test('exposes run resource budget and resolution error types', function () {
        expect<keyof RunResourceBudgets>().type.toBe<
            'activeResourceCount' | 'javaScriptEngineHeapBytes' | 'residentSetBytes' | 'residentSetGrowthBytesPerSecond'
        >();
        expect(new RunResolutionError('Unsupported.', undefined, 'unsupported-request')).type.toBe<
            RunResolutionError
        >();
    });

    test('exposes profile file discovery types', function () {
        expect<RunMicrotestProfileConfig['files']>().type.toBe<RunProfileFiles | null>();
        expect<RunIntegrationProfileConfig['files']>().type.toBe<RunProfileFiles>();
        expect<RunProfileFiles>().type.toBeAssignableFrom<RuntimeProfileFilePatterns>();
        expect<RunProfileFiles>().type.toBeAssignableFrom<RuntimeProfileFileSets>();
        expect<RunProfileFiles>().type.not.toBeAssignableFrom<MixedRuntimeProfileFiles>();
        expect<RunProjectMicrotestProfileConfig['files']>().type.toBe<RunProjectProfileFiles | undefined>();
        expect<RunProjectIntegrationProfileConfig['files']>().type.toBe<RunProjectProfileFiles>();
        expect<RunProjectProfileFiles>().type.toBeAssignableFrom<ProjectProfileFilePatterns>();
        expect<RunProjectProfileFiles>().type.toBeAssignableFrom<ProjectProfileFileSets>();
    });

    test('exposes config loading helpers from the main package surface', function () {
        expect<typeof defineConfig>().type.toBe<(config: RunProjectConfig) => RunProjectConfig>();
        expect<typeof loadRunConfig>().type.toBe<
            (request: RunConfigLoadRequest) => Promise<LoadedRunConfig>
        >();
        expect<RunProjectConfig['outputRenderer']>().type.toBe<DefinedOutputRenderer | undefined>();
        expect<RunProjectConfig['reporters']>().type.toBe<
            readonly [DefinedReporter, ...DefinedReporter[]] | undefined
        >();
        expect<RunProjectProfileConfig>().type.toBe<
            RunProjectIntegrationProfileConfig | RunProjectMicrotestProfileConfig
        >();
        expect<RunProjectProfileConfig>().type.toBeAssignableFrom<{
            readonly execution: RunProjectMicrotestProfileConfig['execution'];
            readonly testFamily: 'microtest';
        }>();
        expect<RunProjectProfileConfig>().type.toBeAssignableFrom<{
            readonly files: RunProjectProfileFiles;
            readonly testFamily: 'integration';
        }>();
        expect<RunIntegrationProfileConfig>().type.toBeAssignableFrom<{
            readonly execution: {
                readonly hostProcess: { readonly kind: 'child'; readonly nodeArguments: readonly string[]; };
                readonly processModel: 'worker-pool';
                readonly scheduling: 'concurrent';
                readonly assignmentPolicy: 'case-count-balanced';
                readonly dispatchPolicy: 'dynamic-lease';
                readonly hedging: { readonly mode: 'off'; };
                readonly workDistribution: { readonly mode: 'file'; };
                readonly workerLifecycle: 'reuse';
            };
            readonly files: RunProfileFiles;
            readonly reporters: null;
            readonly resourceUsage: RunResourceUsagePolicy;
            readonly testFamily: 'integration';
            readonly timings: TimingProfilePolicy;
            readonly timeouts: RunExecutionFacts['timeoutPolicy'];
        }>();
        expect<RunProjectIntegrationProfileConfig>().type.not.toBeAssignableFrom<{
            readonly execution: {
                readonly hostProcess: { readonly kind: 'child'; readonly nodeArguments: readonly string[]; };
                readonly processModel: 'worker-pool';
            };
            readonly files: RunProjectProfileFiles;
            readonly testFamily: 'integration';
        }>();
        expect(new RunConfigError('Invalid config.')).type.toBe<RunConfigError>();
    });
});

import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { acceptsCall, assignableFrom, rejectsCall, sameType } from '@overkill-dev/type-test';
import type { ProjectDefinedFamilyProfile } from '../../config/schema.ts';
import type {
    AttachmentLimits,
    FailureArtifactPolicy,
    DefinedOutputRenderer,
    DefinedReporter,
    TestAnnotationsInput,
    TestControlsInput
} from '../engine/engine.entry-point.ts';
import type { OrdinaryBaselinePolicy } from './config.entry-point.ts';
import {
    ConfigError,
    RunResolutionError,
    type TestProfileConfig,
    type defineConfig,
    type DynamicWorkUnitId,
    type loadConfig,
    type LoadedConfig,
    type PlacementPlan,
    type PlacementTrace,
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
    type runIfMain,
    type IntegrationExecution,
    type IntegrationProfileConfig,
    type MaxConcurrency,
    type MicrotestExecution,
    type RunSelection,
    type MicrotestProfileConfig,
    type PropertyProfileConfig,
    type RunOrder,
    type ProcessModel,
    type ProfileConfig,
    type BenchmarkProfileConfig,
    type DefinedFamilyProfile,
    type ProfileFiles,
    type Config,
    type ProjectIntegrationProfileConfig,
    type ProjectIntegrationExecution,
    type ProjectProfileFiles,
    type ProjectMicrotestProfileConfig,
    type ProjectPropertyProfileConfig,
    type ProjectMicrotestExecution,
    type ProjectProfileConfig,
    type ProjectBenchmarkProfileConfig,
    type ProcessBudgets,
    type ProcessUsagePolicy,
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
declare const mainTest: Parameters<RunIfMain>[1];

type RunRequestKeys = readonly [
    'baselineUpdateMode',
    'capabilityRestrictions',
    'capture',
    'coverage',
    'debug',
    'execution',
    'measureProcessUsage',
    'order',
    'paths',
    'profile',
    'record',
    'recordForMerge',
    'lastFailed',
    'processBudgetOverrides',
    'processUsageSamplingIntervalMilliseconds',
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

type OrdinaryProfile = IntegrationProfileConfig | MicrotestProfileConfig | PropertyProfileConfig;
type OrdinaryProjectProfile = ProjectIntegrationProfileConfig | ProjectMicrotestProfileConfig;

declare const runIfMainUnderTest: typeof runIfMain;
declare const defineConfigUnderTest: typeof defineConfig;

export const testNode = suite('run', [
    suite('@overkill-dev/run', [
        test('exposes the typed run command surface', function (typeScope) {
            typeScope.assert(sameType<keyof RunCommand, 'config' | 'cwd' | 'engine' | 'request'>());
            typeScope.assert(sameType<IsEqual<RunCommand['config'], NormalizedConfig>, true>());
            typeScope.assert(sameType<RunCommand['cwd'], string>());
            typeScope.assert(sameType<IsEqual<RunCommand['engine'], RunEngineSelection>, true>());
            typeScope.assert(sameType<RunCommand['request'], RunRequest>());
            return typeScope.assert.collect();
        }),
        test('exposes the direct-file execution companion', function (typeScope) {
            typeScope.assert(sameType<IsEqual<typeof runIfMain, RunIfMain>, true>());
            typeScope.assert(sameType<
                IsEqual<RunIfMainOptions, {
                    readonly outputRenderer?: DefinedOutputRenderer;
                    readonly reporters?: readonly DefinedReporter[];
                    readonly root?: RunIfMainRootOptions;
                }>,
                true
            >());
            typeScope.assert(sameType<RunIfMainRootOptions, {
                readonly annotations?: TestAnnotationsInput;
                readonly controls?: TestControlsInput;
                readonly title: string;
            }>());
            typeScope.assert(acceptsCall, () => runIfMainUnderTest(import.meta, mainTest));
            typeScope.assert(acceptsCall, () =>
                runIfMainUnderTest(import.meta, mainTest, {
                    outputRenderer,
                    reporters: [ reporter ],
                    root: {
                        annotations: {},
                        controls: {},
                        title: 'root'
                    }
                }));
            typeScope.assert(
                rejectsCall('argument-type'),
                () => runIfMainUnderTest(import.meta, mainTest, { runFacts: {} })
            );
            typeScope.assert(
                rejectsCall('argument-type'),
                () => runIfMainUnderTest(import.meta, mainTest, { profile: 'microtest' })
            );
            typeScope.assert(
                rejectsCall('argument-type'),
                () => runIfMainUnderTest(import.meta, mainTest, { cwd: 'project' })
            );
            return typeScope.assert.collect();
        }),
        test('keeps request fields explicit for the implemented runner slice', function (typeScope) {
            typeScope.assert(sameType<keyof RunRequest, ExpectedRunRequestKey>());
            typeScope.assert(sameType<RunRequest['capabilityRestrictions']['mode'], 'disabled' | 'enabled'>());
            typeScope.assert(sameType<RunRequest['execution']['mode'], 'profile-default' | 'serial'>());
            typeScope.assert(sameType<RunRequest['measureProcessUsage'], boolean | null>());
            typeScope.assert(sameType<RunRequest['profile'], string>());
            typeScope.assert(sameType<RunRequest['processBudgetOverrides'], ProcessBudgets | null>());
            typeScope.assert(sameType<RunRequest['timingCollection'], TimingCollectionOverride>());
            typeScope.assert(sameType<Pick<RunRequest, 'capture' | 'coverage' | 'order'>, {
                readonly capture: 'buffered' | 'live';
                readonly coverage: boolean;
                readonly order: RunOrder;
            }>());
            typeScope.assert(sameType<RunOrder, 'lexical' | 'plan' | 'seeded'>());
            typeScope.assert(sameType<RunRequest['selection'], RunSelection>());
            return typeScope.assert.collect();
        }),
        test('exposes serializable run execution facts', function (typeScope) {
            typeScope.assert(sameType<RunExecutionFacts['engine']['kind'], 'default' | 'instance' | 'module'>());
            typeScope.assert(sameType<RunExecutionFacts['capture'], 'buffered' | 'live'>());
            typeScope.assert(sameType<RunExecutionFacts['coverage'], boolean>());
            typeScope.assert(sameType<RunExecutionFacts['maxConcurrency'], MaxConcurrency>());
            typeScope.assert(sameType<RunExecutionFacts['processModel'], ProcessModel>());
            typeScope.assert(sameType<RunExecutionFacts['placementPlan'], PlacementPlan | null>());
            typeScope.assert(sameType<RunExecutionFacts['profile'], string>());
            typeScope.assert(sameType<RunExecutionFacts['processUsagePolicy'], ProcessUsagePolicy>());
            typeScope.assert(sameType<RunExecutionFacts['timingCollection'], TimingCollectionMode>());
            return typeScope.assert.collect();
        }),
        test('exposes case file set facts', function (typeScope) {
            typeScope.assert(sameType<RunFacts['cases'][number]['fileSet'], string | null>());
            return typeScope.assert.collect();
        }),
        test('only exposes profile-default and serial execution requests', function (typeScope) {
            typeScope.assert(assignableFrom.not<RunRequest['execution'], { readonly mode: 'concurrent'; }>());
            typeScope.assert(assignableFrom.not<RunRequest['execution'], { readonly mode: 'supervised-process'; }>());
            return typeScope.assert.collect();
        }),
        test('exposes run scheduling and family facts', function (typeScope) {
            typeScope.assert(sameType<RunExecutionFacts['scheduling'], Scheduling>());
            typeScope.assert(sameType<RunExecutionFacts['testFamily'], RunTestFamily>());
            typeScope.assert(
                sameType<
                    Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['workerLifecycle'],
                    WorkerLifecycle
                >()
            );
            typeScope.assert(
                sameType<
                    Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['workDistribution'],
                    WorkDistribution
                >()
            );
            typeScope.assert(
                sameType<
                    Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['hostProcess'],
                    RunHostProcessFacts
                >()
            );
            typeScope.assert(sameType<HostProcess, ExpectedRunHostProcess>());
            typeScope.assert(sameType<RunHostProcessFacts, ExpectedRunHostProcessFacts>());
            typeScope.assert(sameType<
                RunHostProcessReason,
                keyof {
                    readonly 'benchmark-isolation': true;
                    readonly debugging: true;
                    readonly 'forced-garbage-collection': true;
                    readonly 'host-isolation': true;
                    readonly 'node-arguments': true;
                    readonly profiling: true;
                }
            >());
            typeScope.assert(sameType<WorkDistribution, ExpectedRunWorkDistribution>());
            typeScope.assert(sameType<WorkGroup, {
                readonly fileSets: readonly [string, ...readonly string[]];
                readonly granularity: WorkGroupGranularity;
                readonly name: string;
                readonly order: WorkGroupOrder;
                readonly scheduling: WorkGroupScheduling;
                readonly workerLifecycle: WorkGroupWorkerLifecycle;
            }>());
            return typeScope.assert.collect();
        }),
        test('exposes worker-pool placement facts', function (typeScope) {
            typeScope.assert(
                sameType<
                    Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['placementPlan'],
                    PlacementPlan | null
                >()
            );
            typeScope.assert(
                sameType<
                    Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['dispatchPolicy'],
                    WorkerPoolDispatchPolicy
                >()
            );
            return typeScope.assert.collect();
        }),
        test('exposes work-unit planning types', function (typeScope) {
            typeScope.assert(sameType<RuntimeId['scenarios'], Readonly<Record<string, string>>>());
            typeScope.assert(sameType<WorkId['runtimes'], readonly RuntimeId[]>());
            typeScope.assert(sameType<WorkId['workload'], WorkloadId | null>());
            typeScope.assert(sameType<WorkUnit['work'], readonly [WorkId, ...readonly WorkId[]]>());
            typeScope.assert(sameType<WorkUnit['id']['mode'], WorkUnitMode>());
            typeScope.assert(sameType<WorkUnit['order'], RunOrder>());
            typeScope.assert(sameType<WorkUnit['scheduling'], Scheduling>());
            typeScope.assert(sameType<WorkUnit['workerLifecycle'], WorkerLifecycle>());
            typeScope.assert(
                sameType<
                    PlacementPlan['lanes'][number]['executor']['kind'],
                    'browser' | 'local-process' | 'local-worker' | 'remote'
                >()
            );
            typeScope.assert(sameType<PlacementPlan['assignments'][number]['unit'], WorkUnit['id']>());
            typeScope.assert(sameType<PlacementPlan['resourceOwnership'], ResourceOwnershipPlan>());
            return typeScope.assert.collect();
        }),
        test('exposes placement trace entry kinds', function (typeScope) {
            typeScope.assert(
                sameType<
                    Readonly<Record<PlacementTrace['entries'][number]['kind'], true>>,
                    ExpectedPlacementTraceKinds
                >()
            );
            typeScope.assert(sameType<DynamicWorkUnitId, {
                readonly child: string;
                readonly parent: WorkUnitId;
            }>());
            typeScope.assert(sameType<TraceWorkUnitId, DynamicWorkUnitId | WorkUnitId>());
            return typeScope.assert.collect();
        })
    ]),
    test('exposes timing collection request types', function (typeScope) {
        typeScope.assert(sameType<TimingCollectionOverride, 'precise' | 'profile-default'>());
        typeScope.assert(sameType<TimingCollectionMode, 'precise' | 'summary'>());
        return typeScope.assert.collect();
    }),
    suite('@overkill-dev/run worker-pool placement', [
        test('exposes worker-count requests', function (typeScope) {
            typeScope.assert(sameType<RunRequest['workers'], number | null>());
            return typeScope.assert.collect();
        }),
        test('exposes resolved worker-count facts', function (typeScope) {
            typeScope.assert(
                sameType<
                    Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['workerCount'],
                    RunWorkerCountFacts
                >()
            );
            typeScope.assert(sameType<RunWorkerCountFacts, {
                readonly hostMaximum: number;
                readonly profileMaximum: number | null;
                readonly requested: number | null;
                readonly resolved: number;
            }>());
            return typeScope.assert.collect();
        }),
        test('exposes worker-pool profile maximums', function (typeScope) {
            typeScope.assert(sameType<
                [{
                    readonly execution: {
                        readonly maxWorkers: number;
                        readonly processModel: 'worker-pool';
                    };
                    readonly files: ProjectProfileFiles;
                    readonly testFamily: 'integration';
                }] extends [ProjectIntegrationProfileConfig] ? true : false,
                true
            >());
            return typeScope.assert.collect();
        }),
        test('exposes per-executor concurrency limits', function (typeScope) {
            typeScope.assert(sameType<MaxConcurrency, number | 'unlimited'>());
            typeScope.assert(sameType<MicrotestExecution['maxConcurrency'], MaxConcurrency>());
            typeScope.assert(sameType<IntegrationExecution['maxConcurrency'], MaxConcurrency>());
            typeScope.assert(assignableFrom<ProjectMicrotestExecution, {
                readonly maxConcurrency: 'unlimited';
                readonly processModel: 'in-process';
            }>());
            typeScope.assert(assignableFrom<ProjectIntegrationExecution, {
                readonly maxConcurrency: 'unlimited';
                readonly processModel: 'worker-pool';
            }>());
            return typeScope.assert.collect();
        }),
        test('exposes worker-pool assignment policy facts', function (typeScope) {
            typeScope.assert(
                sameType<
                    Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['assignmentPolicy'],
                    WorkerPoolAssignmentPolicy
                >()
            );
            typeScope.assert(
                sameType<WorkerPoolAssignmentPolicy, 'case-count-balanced' | 'duration-history-balanced' | 'stable'>()
            );
            typeScope.assert(sameType<WorkerPoolDispatchPolicy, 'dynamic-lease' | 'static-assignment'>());
            return typeScope.assert.collect();
        })
    ]),
    suite('@overkill-dev/run config', [
        test('exposes collection, soft, and hard timeout facts', function (typeScope) {
            typeScope.assert(sameType<RunExecutionFacts['timeoutPolicy']['collectionMilliseconds'], number>());
            typeScope.assert(sameType<RunExecutionFacts['timeoutPolicy']['hardMilliseconds'], number>());
            typeScope.assert(sameType<RunExecutionFacts['timeoutPolicy']['softMilliseconds'], number>());
            return typeScope.assert.collect();
        }),
        test('exposes config and resolution errors', function (typeScope) {
            typeScope.assert(
                sameType<
                    keyof NormalizedConfig,
                    'history' | 'loader' | 'outputRenderer' | 'profiles' | 'reporters' | 'runtimeStateDir'
                >()
            );
            typeScope.assert(sameType<NormalizedConfig['outputRenderer'], DefinedOutputRenderer>());
            typeScope.assert(sameType<IsEqual<NormalizedConfig['profiles'][string], ProfileConfig>, true>());
            typeScope.assert(
                sameType<
                    IsEqual<ProfileConfig, BenchmarkProfileConfig | DefinedFamilyProfile | OrdinaryProfile>,
                    true
                >()
            );
            typeScope.assert(sameType<IsEqual<NormalizedConfig['profiles']['backend-http'], ProfileConfig>, true>());
            typeScope.assert(
                sameType<IsEqual<NormalizedConfig['reporters'], readonly DefinedReporter[] | null>, true>()
            );
            typeScope.assert(sameType<TestProfileConfig['timings'], TimingProfilePolicy>());
            typeScope.assert(sameType<TimingProfilePolicy, { readonly collection: TimingCollectionMode; }>());
            typeScope.assert(sameType<ProjectTimingProfilePolicy, { readonly collection: TimingCollectionMode; }>());
            return typeScope.assert.collect();
        }),
        test('exposes run process budget and resolution error types', function (typeScope) {
            typeScope.assert(
                sameType<
                    keyof ProcessBudgets,
                    | 'activeResourceCount'
                    | 'javaScriptEngineHeapBytes'
                    | 'residentSetBytes'
                    | 'residentSetGrowthBytesPerSecond'
                >()
            );
            typeScope.assert(
                sameType.withActual<RunResolutionError>(),
                new RunResolutionError('Unsupported.', undefined, 'unsupported-request')
            );
            typeScope.assert(
                sameType<
                    ReturnType<RunExecutionPlanError['conflicts']>,
                    readonly [RunExecutionPlanConflict, ...readonly RunExecutionPlanConflict[]]
                >()
            );
            return typeScope.assert.collect();
        }),
        test('exposes profile file discovery types', function (typeScope) {
            typeScope.assert(sameType<MicrotestProfileConfig['files'], ProfileFiles | null>());
            typeScope.assert(sameType<IntegrationProfileConfig['files'], ProfileFiles>());
            typeScope.assert(assignableFrom<ProfileFiles, RuntimeProfileFilePatterns>());
            typeScope.assert(assignableFrom<ProfileFiles, RuntimeProfileFileSets>());
            typeScope.assert(assignableFrom.not<ProfileFiles, MixedRuntimeProfileFiles>());
            typeScope.assert(sameType<ProjectMicrotestProfileConfig['files'], ProjectProfileFiles | undefined>());
            typeScope.assert(sameType<ProjectIntegrationProfileConfig['files'], ProjectProfileFiles>());
            typeScope.assert(assignableFrom<ProjectProfileFiles, ProjectProfileFilePatterns>());
            typeScope.assert(assignableFrom<ProjectProfileFiles, ProjectProfileFileSets>());
            return typeScope.assert.collect();
        }),
        test('exposes property profile config types', function (typeScope) {
            typeScope.assert(
                sameType<
                    IsEqual<
                        Exclude<ProjectProfileConfig, ProjectPropertyProfileConfig>,
                        OrdinaryProjectProfile | ProjectBenchmarkProfileConfig | ProjectDefinedFamilyProfile
                    >,
                    true
                >()
            );
            typeScope.assert(
                sameType<
                    Extract<ProjectProfileConfig, { readonly testFamily: 'property'; }>,
                    ProjectPropertyProfileConfig
                >()
            );
            return typeScope.assert.collect();
        }),
        test('exposes config loading helpers from the main package surface', function (typeScope) {
            typeScope.assert(
                acceptsCall,
                () => defineConfigUnderTest({ profiles: { unit: { testFamily: 'microtest' } } })
            );
            typeScope.assert(
                sameType<IsEqual<typeof loadConfig, (request: ConfigLoadRequest) => Promise<LoadedConfig>>, true>()
            );
            typeScope.assert(sameType<Config['outputRenderer'], DefinedOutputRenderer | undefined>());
            typeScope.assert(
                sameType<
                    IsEqual<Config['reporters'], readonly [DefinedReporter, ...DefinedReporter[]] | undefined>,
                    true
                >()
            );
            typeScope.assert(sameType<
                [{
                    readonly execution: ProjectMicrotestProfileConfig['execution'];
                    readonly testFamily: 'microtest';
                }] extends [ProjectProfileConfig] ? true : false,
                true
            >());
            typeScope.assert(sameType<
                [{
                    readonly files: ProjectProfileFiles;
                    readonly testFamily: 'integration';
                }] extends [ProjectProfileConfig] ? true : false,
                true
            >());
            typeScope.assert(sameType<
                [{
                    readonly property: null;
                    readonly baselines: OrdinaryBaselinePolicy;
                    readonly attachments: AttachmentLimits;
                    readonly failureArtifacts: FailureArtifactPolicy;
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
                    readonly processUsage: ProcessUsagePolicy;
                    readonly testFamily: 'integration';
                    readonly runRecords: { readonly persist: 'on-demand'; };
                    readonly timings: TimingProfilePolicy;
                    readonly timeouts: RunExecutionFacts['timeoutPolicy'];
                }] extends [IntegrationProfileConfig] ? true : false,
                true
            >());
            typeScope.assert(sameType<
                [{
                    readonly execution: {
                        readonly hostProcess: { readonly kind: 'child'; readonly nodeArguments: readonly string[]; };
                        readonly processModel: 'worker-pool';
                    };
                    readonly files: ProjectProfileFiles;
                    readonly testFamily: 'integration';
                }] extends [ProjectIntegrationProfileConfig] ? true : false,
                false
            >());
            typeScope.assert(sameType.withActual<ConfigError>(), new ConfigError('Invalid config.'));
            return typeScope.assert.collect();
        })
    ])
]);

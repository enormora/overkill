import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, assignableFrom, rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type {
    DefinedOutputRenderer,
    DefinedReporter,
    TestAnnotationsInput,
    TestControlsInput
} from '../engine/engine.entry-point.ts';
import type {
    DynamicWorkUnitId,
    PlacementPlan,
    PlacementTrace,
    RunCommand,
    NormalizedConfig,
    RunEngineSelection,
    RunExecutionFacts,
    RunFacts,
    RunIfMain,
    RunIfMainOptions,
    RunIfMainRootOptions,
    HostProcess,
    RunHostProcessFacts,
    RunHostProcessReason,
    runIfMain,
    IntegrationExecution,
    MaxConcurrency,
    MicrotestExecution,
    RunSelection,
    RunOrder,
    ProcessModel,
    ProjectIntegrationProfileConfig,
    ProjectIntegrationExecution,
    ProjectProfileFiles,
    ProjectMicrotestExecution,
    ProcessBudgets,
    ProcessUsagePolicy,
    ResourceOwnershipPlan,
    RunRequest,
    Scheduling,
    RunTestFamily,
    TimingCollectionMode,
    TimingCollectionOverride,
    WorkDistribution,
    WorkGroup,
    WorkGroupGranularity,
    WorkGroupOrder,
    WorkGroupScheduling,
    WorkGroupWorkerLifecycle,
    WorkerPoolAssignmentPolicy,
    WorkerPoolDispatchPolicy,
    WorkerLifecycle,
    RunWorkerCountFacts,
    RuntimeId,
    TraceWorkUnitId,
    WorkloadId,
    WorkId,
    WorkUnit,
    WorkUnitId,
    WorkUnitMode
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

declare const runIfMainUnderTest: typeof runIfMain;

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
            typeScope.assert(acceptsCall, async () => runIfMainUnderTest(import.meta, mainTest));
            typeScope.assert(acceptsCall, async () =>
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
                async () => runIfMainUnderTest(import.meta, mainTest, { runFacts: {} })
            );
            typeScope.assert(
                rejectsCall('argument-type'),
                async () => runIfMainUnderTest(import.meta, mainTest, { profile: 'microtest' })
            );
            typeScope.assert(
                rejectsCall('argument-type'),
                async () => runIfMainUnderTest(import.meta, mainTest, { cwd: 'project' })
            );
            return typeScope.assert.collect();
        }),
        suite('keeps request fields explicit for the implemented runner slice', [
            test('types run request selection', function (typeScope) {
                typeScope.assert(sameType<keyof RunRequest, ExpectedRunRequestKey>());
                typeScope.assert(sameType<RunRequest['capabilityRestrictions']['mode'], 'disabled' | 'enabled'>());
                typeScope.assert(sameType<RunRequest['execution']['mode'], 'profile-default' | 'serial'>());
                typeScope.assert(sameType<RunRequest['measureProcessUsage'], boolean | null>());
                typeScope.assert(sameType<RunRequest['profile'], string>());
                return typeScope.assert.collect();
            }),
            test('types run request execution and recording', function (typeScope) {
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
            })
        ]),
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
        suite('exposes run scheduling and family facts', [
            test('types scheduling and family identity', function (typeScope) {
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
                return typeScope.assert.collect();
            }),
            test('types work distribution and identity', function (typeScope) {
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
            })
        ]),
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
        suite('exposes work-unit planning types', [
            test('types work-unit identity', function (typeScope) {
                typeScope.assert(sameType<RuntimeId['scenarios'], Readonly<Record<string, string>>>());
                typeScope.assert(sameType<WorkId['runtimes'], readonly RuntimeId[]>());
                typeScope.assert(sameType<WorkId['workload'], WorkloadId | null>());
                typeScope.assert(sameType<WorkUnit['work'], readonly [WorkId, ...readonly WorkId[]]>());
                typeScope.assert(sameType<WorkUnit['id']['mode'], WorkUnitMode>());
                return typeScope.assert.collect();
            }),
            test('types worker placement and dispatch', function (typeScope) {
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
            })
        ]),
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
    ])
]);

import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type {
    DefinedOutputRenderer,
    DefinedReporter,
    TestAnnotationsInput,
    TestControlsInput
} from '../engine/engine.entry-point.ts';
import type { IsAssignable } from '../../test-support/type-relations.ts';
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
            typeScope.assert(sameType<IsEqual<RunCommand['request'], RunRequest>, true>());
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
            typeScope.assert(sameType<
                IsEqual<RunIfMainRootOptions, {
                    readonly annotations?: TestAnnotationsInput;
                    readonly controls?: TestControlsInput;
                    readonly title: string;
                }>,
                true
            >());
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
                typeScope.assert(sameType<IsEqual<keyof RunRequest, ExpectedRunRequestKey>, true>());
                typeScope.assert(sameType<RunRequest['capabilityRestrictions']['mode'], 'disabled' | 'enabled'>());
                typeScope.assert(sameType<RunRequest['execution']['mode'], 'profile-default' | 'serial'>());
                typeScope.assert(sameType<RunRequest['measureProcessUsage'], boolean | null>());
                typeScope.assert(sameType<RunRequest['profile'], string>());
                return typeScope.assert.collect();
            }),
            test('types run request execution and recording', function (typeScope) {
                typeScope.assert(
                    sameType<IsEqual<RunRequest['processBudgetOverrides'], ProcessBudgets | null>, true>()
                );
                typeScope.assert(sameType<IsEqual<RunRequest['timingCollection'], TimingCollectionOverride>, true>());
                typeScope.assert(sameType<
                    IsEqual<Pick<RunRequest, 'capture' | 'coverage' | 'order'>, {
                        readonly capture: 'buffered' | 'live';
                        readonly coverage: boolean;
                        readonly order: RunOrder;
                    }>,
                    true
                >());
                typeScope.assert(sameType<RunOrder, 'lexical' | 'plan' | 'seeded'>());
                typeScope.assert(sameType<IsEqual<RunRequest['selection'], RunSelection>, true>());
                return typeScope.assert.collect();
            })
        ]),
        test('exposes serializable run execution facts', function (typeScope) {
            typeScope.assert(sameType<RunExecutionFacts['engine']['kind'], 'default' | 'instance' | 'module'>());
            typeScope.assert(sameType<RunExecutionFacts['capture'], 'buffered' | 'live'>());
            typeScope.assert(sameType<RunExecutionFacts['coverage'], boolean>());
            typeScope.assert(sameType<IsEqual<RunExecutionFacts['maxConcurrency'], MaxConcurrency>, true>());
            typeScope.assert(sameType<IsEqual<RunExecutionFacts['processModel'], ProcessModel>, true>());
            typeScope.assert(sameType<IsEqual<RunExecutionFacts['placementPlan'], PlacementPlan | null>, true>());
            typeScope.assert(sameType<RunExecutionFacts['profile'], string>());
            typeScope.assert(sameType<IsEqual<RunExecutionFacts['processUsagePolicy'], ProcessUsagePolicy>, true>());
            typeScope.assert(sameType<IsEqual<RunExecutionFacts['timingCollection'], TimingCollectionMode>, true>());
            return typeScope.assert.collect();
        }),
        test('exposes case file set facts', function (typeScope) {
            typeScope.assert(sameType<RunFacts['cases'][number]['fileSet'], string | null>());
            return typeScope.assert.collect();
        }),
        test('only exposes profile-default and serial execution requests', function (typeScope) {
            typeScope.assert(
                sameType<IsAssignable<{ readonly mode: 'concurrent'; }, RunRequest['execution']>, false>()
            );
            typeScope.assert(
                sameType<IsAssignable<{ readonly mode: 'supervised-process'; }, RunRequest['execution']>, false>()
            );
            return typeScope.assert.collect();
        }),
        suite('exposes run scheduling and family facts', [
            test('types scheduling and family identity', function (typeScope) {
                typeScope.assert(sameType<IsEqual<RunExecutionFacts['scheduling'], Scheduling>, true>());
                typeScope.assert(sameType<IsEqual<RunExecutionFacts['testFamily'], RunTestFamily>, true>());
                typeScope.assert(
                    sameType<
                        IsEqual<
                            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['workerLifecycle'],
                            WorkerLifecycle
                        >,
                        true
                    >()
                );
                typeScope.assert(
                    sameType<
                        IsEqual<
                            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['workDistribution'],
                            WorkDistribution
                        >,
                        true
                    >()
                );
                typeScope.assert(
                    sameType<
                        IsEqual<
                            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['hostProcess'],
                            RunHostProcessFacts
                        >,
                        true
                    >()
                );
                return typeScope.assert.collect();
            }),
            test('types work distribution and identity', function (typeScope) {
                typeScope.assert(sameType<IsEqual<HostProcess, ExpectedRunHostProcess>, true>());
                typeScope.assert(sameType<IsEqual<RunHostProcessFacts, ExpectedRunHostProcessFacts>, true>());
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
                typeScope.assert(sameType<IsEqual<WorkDistribution, ExpectedRunWorkDistribution>, true>());
                typeScope.assert(sameType<
                    IsEqual<WorkGroup, {
                        readonly fileSets: readonly [string, ...readonly string[]];
                        readonly granularity: WorkGroupGranularity;
                        readonly name: string;
                        readonly order: WorkGroupOrder;
                        readonly scheduling: WorkGroupScheduling;
                        readonly workerLifecycle: WorkGroupWorkerLifecycle;
                    }>,
                    true
                >());
                return typeScope.assert.collect();
            })
        ]),
        test('exposes worker-pool placement facts', function (typeScope) {
            typeScope.assert(
                sameType<
                    IsEqual<
                        Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['placementPlan'],
                        PlacementPlan | null
                    >,
                    true
                >()
            );
            typeScope.assert(
                sameType<
                    IsEqual<
                        Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['dispatchPolicy'],
                        WorkerPoolDispatchPolicy
                    >,
                    true
                >()
            );
            return typeScope.assert.collect();
        }),
        suite('exposes work-unit planning types', [
            test('types work-unit identity', function (typeScope) {
                typeScope.assert(sameType<IsEqual<RuntimeId['scenarios'], Readonly<Record<string, string>>>, true>());
                typeScope.assert(sameType<IsEqual<WorkId['runtimes'], readonly RuntimeId[]>, true>());
                typeScope.assert(sameType<IsEqual<WorkId['workload'], WorkloadId | null>, true>());
                typeScope.assert(sameType<IsEqual<WorkUnit['work'], readonly [WorkId, ...readonly WorkId[]]>, true>());
                typeScope.assert(sameType<IsEqual<WorkUnit['id']['mode'], WorkUnitMode>, true>());
                return typeScope.assert.collect();
            }),
            test('types worker placement and dispatch', function (typeScope) {
                typeScope.assert(sameType<IsEqual<WorkUnit['order'], RunOrder>, true>());
                typeScope.assert(sameType<IsEqual<WorkUnit['scheduling'], Scheduling>, true>());
                typeScope.assert(sameType<IsEqual<WorkUnit['workerLifecycle'], WorkerLifecycle>, true>());
                typeScope.assert(
                    sameType<
                        PlacementPlan['lanes'][number]['executor']['kind'],
                        'browser' | 'local-process' | 'local-worker' | 'remote'
                    >()
                );
                typeScope.assert(
                    sameType<IsEqual<PlacementPlan['assignments'][number]['unit'], WorkUnit['id']>, true>()
                );
                typeScope.assert(sameType<IsEqual<PlacementPlan['resourceOwnership'], ResourceOwnershipPlan>, true>());
                return typeScope.assert.collect();
            })
        ]),
        test('exposes placement trace entry kinds', function (typeScope) {
            typeScope.assert(
                sameType<
                    IsEqual<
                        Readonly<Record<PlacementTrace['entries'][number]['kind'], true>>,
                        ExpectedPlacementTraceKinds
                    >,
                    true
                >()
            );
            typeScope.assert(sameType<
                IsEqual<DynamicWorkUnitId, {
                    readonly child: string;
                    readonly parent: WorkUnitId;
                }>,
                true
            >());
            typeScope.assert(sameType<IsEqual<TraceWorkUnitId, DynamicWorkUnitId | WorkUnitId>, true>());
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
                    IsEqual<
                        Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['workerCount'],
                        RunWorkerCountFacts
                    >,
                    true
                >()
            );
            typeScope.assert(sameType<
                IsEqual<RunWorkerCountFacts, {
                    readonly hostMaximum: number;
                    readonly profileMaximum: number | null;
                    readonly requested: number | null;
                    readonly resolved: number;
                }>,
                true
            >());
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
            typeScope.assert(sameType<IsEqual<MicrotestExecution['maxConcurrency'], MaxConcurrency>, true>());
            typeScope.assert(sameType<IsEqual<IntegrationExecution['maxConcurrency'], MaxConcurrency>, true>());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly maxConcurrency: 'unlimited';
                    readonly processModel: 'in-process';
                }, ProjectMicrotestExecution>,
                true
            >());
            typeScope.assert(sameType<
                IsAssignable<{
                    readonly maxConcurrency: 'unlimited';
                    readonly processModel: 'worker-pool';
                }, ProjectIntegrationExecution>,
                true
            >());
            return typeScope.assert.collect();
        }),
        test('exposes worker-pool assignment policy facts', function (typeScope) {
            typeScope.assert(
                sameType<
                    IsEqual<
                        Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['assignmentPolicy'],
                        WorkerPoolAssignmentPolicy
                    >,
                    true
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

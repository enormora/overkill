import type { IsEqual } from 'type-fest';
import { suite, test } from '../test/test.entry-point.ts';
import { acceptsCall, rejectsCall, sameType } from '../type-test/type-test.entry-point.ts';
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

export const testNode = suite('Run requests, execution facts, and worker placement', [
    suite('Run invocation and execution facts', [
        test('exposes the typed run command surface', function (scope) {
            scope.assert(sameType<keyof RunCommand, 'config' | 'cwd' | 'engine' | 'request'>());
            scope.assert(sameType<IsEqual<RunCommand['config'], NormalizedConfig>, true>());
            scope.assert(sameType<RunCommand['cwd'], string>());
            scope.assert(sameType<IsEqual<RunCommand['engine'], RunEngineSelection>, true>());
            scope.assert(sameType<IsEqual<RunCommand['request'], RunRequest>, true>());
            return scope.assert.collect();
        }),
        test('exposes the direct-file execution companion', function (scope) {
            scope.assert(sameType<IsEqual<typeof runIfMain, RunIfMain>, true>());
            scope.assert(sameType<
                IsEqual<RunIfMainOptions, {
                    readonly outputRenderer?: DefinedOutputRenderer;
                    readonly reporters?: readonly DefinedReporter[];
                    readonly root?: RunIfMainRootOptions;
                }>,
                true
            >());
            scope.assert(sameType<
                IsEqual<RunIfMainRootOptions, {
                    readonly annotations?: TestAnnotationsInput;
                    readonly controls?: TestControlsInput;
                    readonly title: string;
                }>,
                true
            >());
            scope.assert(acceptsCall, async function () {
                return runIfMainUnderTest(import.meta, mainTest);
            });
            scope.assert(acceptsCall, async function () {
                return runIfMainUnderTest(import.meta, mainTest, {
                    outputRenderer,
                    reporters: [ reporter ],
                    root: {
                        annotations: {},
                        controls: {},
                        title: 'root'
                    }
                });
            });
            scope.assert(
                rejectsCall('argument-type'),
                async function () {
                    return runIfMainUnderTest(import.meta, mainTest, { runFacts: {} });
                }
            );
            scope.assert(
                rejectsCall('argument-type'),
                async function () {
                    return runIfMainUnderTest(import.meta, mainTest, { profile: 'microtest' });
                }
            );
            scope.assert(
                rejectsCall('argument-type'),
                async function () {
                    return runIfMainUnderTest(import.meta, mainTest, { cwd: 'project' });
                }
            );
            return scope.assert.collect();
        }),
        suite('keeps request fields explicit for the implemented runner slice', [
            test('types run request selection', function (scope) {
                scope.assert(sameType<IsEqual<keyof RunRequest, ExpectedRunRequestKey>, true>());
                scope.assert(sameType<RunRequest['capabilityRestrictions']['mode'], 'disabled' | 'enabled'>());
                scope.assert(sameType<RunRequest['execution']['mode'], 'profile-default' | 'serial'>());
                scope.assert(sameType<RunRequest['measureProcessUsage'], boolean | null>());
                scope.assert(sameType<RunRequest['profile'], string>());
                return scope.assert.collect();
            }),
            test('types run request execution and recording', function (scope) {
                scope.assert(
                    sameType<IsEqual<RunRequest['processBudgetOverrides'], ProcessBudgets | null>, true>()
                );
                scope.assert(sameType<IsEqual<RunRequest['timingCollection'], TimingCollectionOverride>, true>());
                scope.assert(sameType<
                    IsEqual<Pick<RunRequest, 'capture' | 'coverage' | 'order'>, {
                        readonly capture: 'buffered' | 'live';
                        readonly coverage: boolean;
                        readonly order: RunOrder;
                    }>,
                    true
                >());
                scope.assert(sameType<RunOrder, 'lexical' | 'plan' | 'seeded'>());
                scope.assert(sameType<IsEqual<RunRequest['selection'], RunSelection>, true>());
                return scope.assert.collect();
            })
        ]),
        test('exposes serializable run execution facts', function (scope) {
            scope.assert(sameType<RunExecutionFacts['engine']['kind'], 'default' | 'instance' | 'module'>());
            scope.assert(sameType<RunExecutionFacts['capture'], 'buffered' | 'live'>());
            scope.assert(sameType<RunExecutionFacts['coverage'], boolean>());
            scope.assert(sameType<IsEqual<RunExecutionFacts['maxConcurrency'], MaxConcurrency>, true>());
            scope.assert(sameType<IsEqual<RunExecutionFacts['processModel'], ProcessModel>, true>());
            scope.assert(sameType<IsEqual<RunExecutionFacts['placementPlan'], PlacementPlan | null>, true>());
            scope.assert(sameType<RunExecutionFacts['profile'], string>());
            scope.assert(sameType<IsEqual<RunExecutionFacts['processUsagePolicy'], ProcessUsagePolicy>, true>());
            scope.assert(sameType<IsEqual<RunExecutionFacts['timingCollection'], TimingCollectionMode>, true>());
            return scope.assert.collect();
        }),
        test('exposes case file set facts', function (scope) {
            scope.assert(sameType<RunFacts['cases'][number]['fileSet'], string | null>());
            return scope.assert.collect();
        }),
        test('only exposes profile-default and serial execution requests', function (scope) {
            scope.assert(
                sameType<IsAssignable<{ readonly mode: 'concurrent'; }, RunRequest['execution']>, false>()
            );
            scope.assert(
                sameType<IsAssignable<{ readonly mode: 'supervised-process'; }, RunRequest['execution']>, false>()
            );
            return scope.assert.collect();
        }),
        suite('exposes run scheduling and family facts', [
            test('types scheduling and family identity', function (scope) {
                scope.assert(sameType<IsEqual<RunExecutionFacts['scheduling'], Scheduling>, true>());
                scope.assert(sameType<IsEqual<RunExecutionFacts['testFamily'], RunTestFamily>, true>());
                scope.assert(
                    sameType<
                        IsEqual<
                            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['workerLifecycle'],
                            WorkerLifecycle
                        >,
                        true
                    >()
                );
                scope.assert(
                    sameType<
                        IsEqual<
                            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['workDistribution'],
                            WorkDistribution
                        >,
                        true
                    >()
                );
                scope.assert(
                    sameType<
                        IsEqual<
                            Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['hostProcess'],
                            RunHostProcessFacts
                        >,
                        true
                    >()
                );
                return scope.assert.collect();
            }),
            test('types work distribution and identity', function (scope) {
                scope.assert(sameType<IsEqual<HostProcess, ExpectedRunHostProcess>, true>());
                scope.assert(sameType<IsEqual<RunHostProcessFacts, ExpectedRunHostProcessFacts>, true>());
                scope.assert(sameType<
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
                scope.assert(sameType<IsEqual<WorkDistribution, ExpectedRunWorkDistribution>, true>());
                scope.assert(sameType<
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
                return scope.assert.collect();
            })
        ]),
        test('exposes worker-pool placement facts', function (scope) {
            scope.assert(
                sameType<
                    IsEqual<
                        Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['placementPlan'],
                        PlacementPlan | null
                    >,
                    true
                >()
            );
            scope.assert(
                sameType<
                    IsEqual<
                        Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['dispatchPolicy'],
                        WorkerPoolDispatchPolicy
                    >,
                    true
                >()
            );
            return scope.assert.collect();
        }),
        suite('exposes work-unit planning types', [
            test('types work-unit identity', function (scope) {
                scope.assert(sameType<IsEqual<RuntimeId['scenarios'], Readonly<Record<string, string>>>, true>());
                scope.assert(sameType<IsEqual<WorkId['runtimes'], readonly RuntimeId[]>, true>());
                scope.assert(sameType<IsEqual<WorkId['workload'], WorkloadId | null>, true>());
                scope.assert(sameType<IsEqual<WorkUnit['work'], readonly [WorkId, ...readonly WorkId[]]>, true>());
                scope.assert(sameType<IsEqual<WorkUnit['id']['mode'], WorkUnitMode>, true>());
                return scope.assert.collect();
            }),
            test('types worker placement and dispatch', function (scope) {
                scope.assert(sameType<IsEqual<WorkUnit['order'], RunOrder>, true>());
                scope.assert(sameType<IsEqual<WorkUnit['scheduling'], Scheduling>, true>());
                scope.assert(sameType<IsEqual<WorkUnit['workerLifecycle'], WorkerLifecycle>, true>());
                scope.assert(
                    sameType<
                        PlacementPlan['lanes'][number]['executor']['kind'],
                        'browser' | 'local-process' | 'local-worker' | 'remote'
                    >()
                );
                scope.assert(
                    sameType<IsEqual<PlacementPlan['assignments'][number]['unit'], WorkUnit['id']>, true>()
                );
                scope.assert(sameType<IsEqual<PlacementPlan['resourceOwnership'], ResourceOwnershipPlan>, true>());
                return scope.assert.collect();
            })
        ]),
        test('exposes placement trace entry kinds', function (scope) {
            scope.assert(
                sameType<
                    IsEqual<
                        Readonly<Record<PlacementTrace['entries'][number]['kind'], true>>,
                        ExpectedPlacementTraceKinds
                    >,
                    true
                >()
            );
            scope.assert(sameType<
                IsEqual<DynamicWorkUnitId, {
                    readonly child: string;
                    readonly parent: WorkUnitId;
                }>,
                true
            >());
            scope.assert(sameType<IsEqual<TraceWorkUnitId, DynamicWorkUnitId | WorkUnitId>, true>());
            return scope.assert.collect();
        })
    ]),
    test('exposes timing collection request types', function (scope) {
        scope.assert(sameType<TimingCollectionOverride, 'precise' | 'profile-default'>());
        scope.assert(sameType<TimingCollectionMode, 'precise' | 'summary'>());
        return scope.assert.collect();
    }),
    suite('Worker-pool placement and leases', [
        test('exposes worker-count requests', function (scope) {
            scope.assert(sameType<RunRequest['workers'], number | null>());
            return scope.assert.collect();
        }),
        test('exposes resolved worker-count facts', function (scope) {
            scope.assert(
                sameType<
                    IsEqual<
                        Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['workerCount'],
                        RunWorkerCountFacts
                    >,
                    true
                >()
            );
            scope.assert(sameType<
                IsEqual<RunWorkerCountFacts, {
                    readonly hostMaximum: number;
                    readonly profileMaximum: number | null;
                    readonly requested: number | null;
                    readonly resolved: number;
                }>,
                true
            >());
            return scope.assert.collect();
        }),
        test('exposes worker-pool profile maximums', function (scope) {
            scope.assert(sameType<
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
            return scope.assert.collect();
        }),
        test('exposes per-executor concurrency limits', function (scope) {
            scope.assert(sameType<MaxConcurrency, number | 'unlimited'>());
            scope.assert(sameType<IsEqual<MicrotestExecution['maxConcurrency'], MaxConcurrency>, true>());
            scope.assert(sameType<IsEqual<IntegrationExecution['maxConcurrency'], MaxConcurrency>, true>());
            scope.assert(sameType<
                IsAssignable<{
                    readonly maxConcurrency: 'unlimited';
                    readonly processModel: 'in-process';
                }, ProjectMicrotestExecution>,
                true
            >());
            scope.assert(sameType<
                IsAssignable<{
                    readonly maxConcurrency: 'unlimited';
                    readonly processModel: 'worker-pool';
                }, ProjectIntegrationExecution>,
                true
            >());
            return scope.assert.collect();
        }),
        test('exposes worker-pool assignment policy facts', function (scope) {
            scope.assert(
                sameType<
                    IsEqual<
                        Extract<RunExecutionFacts, { readonly processModel: 'worker-pool'; }>['assignmentPolicy'],
                        WorkerPoolAssignmentPolicy
                    >,
                    true
                >()
            );
            scope.assert(
                sameType<WorkerPoolAssignmentPolicy, 'case-count-balanced' | 'duration-history-balanced' | 'stable'>()
            );
            scope.assert(sameType<WorkerPoolDispatchPolicy, 'dynamic-lease' | 'static-assignment'>());
            return scope.assert.collect();
        })
    ])
]);

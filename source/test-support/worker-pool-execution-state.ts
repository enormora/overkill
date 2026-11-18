import { defaultFailureArtifactPolicy, type CaseId, type RunResult } from '../packages/engine/engine.entry-point.ts';
import type {
    CreatedWorkerPool,
    RunOrchestratorDependencies
} from '../run/run-orchestrator-dependencies.ts';
import {
    createStoredRunValue,
    createSupervisedRunState,
    type SupervisedRunState
} from '../run/supervised-run-state.ts';
import { createReporterEventBuffer } from '../run/worker-pool-execution.ts';

import {
    createWorkerPoolPlacementTraceRecorder,
    type WorkerPoolRunRuntime,
    type WorkerPoolTaskRun
} from '../run/worker-pool-runtime.ts';
import { defaultRunConfig, defaultRunRequest } from './run-command-factory.ts';
import { fakeWorkerPoolRuntimeDependencies } from './worker-pool-runtime-fixtures.ts';

type CollectedRunPlan = WorkerPoolRunRuntime['collectedPlan'];

type PlacementPlan = NonNullable<WorkerPoolRunRuntime['resolvedRun']['facts']['execution']['placementPlan']>;

type ActiveAttempt = ReturnType<WorkerPoolTaskRun['activeAttempt']['read']>;

type BatchEnvelopeId = ReturnType<WorkerPoolTaskRun['envelopeId']['read']>;

const integrationPath = 'source/integration-tests/run/fixtures/passing.test.ts';

export const crashLimitMessage = 'Worker-pool stopped after 3 worker crashes.';

const annotations = { ownership: [], tags: [] };

const controls = { capture: null, duplicateExecution: null, timeoutMilliseconds: null };

export const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ]
} as const;

const defaultUnitPolicy = {
    order: 'plan',
    resourceConstraints: {
        affinityKeys: [],
        capacityWeight: 1,
        duplicateExecution: [],
        faultDomains: [],
        serialKeys: [],
        singleWorkerKeys: []
    },
    scheduling: 'serial',
    workerLifecycle: 'reuse'
} as const;

export function firstCaseId(): CaseId {
    return {
        file: integrationPath,
        params: null,
        suite: [ 'integration' ],
        title: 'first'
    };
}

export function firstCaseIdentityKey(): string {
    const { file, params, suite, title } = firstCaseId();

    return JSON.stringify([ file, suite, title, params ]);
}

export function createCollectedPlan(): CollectedRunPlan {
    return {
        implementations: null,

        family: null,
        defined: 1,
        discoveredFiles: [],
        files: [
            {
                file: integrationPath,
                cases: [
                    {
                        implementationDeclaration: null,

                        skipReason: null,
                        property: null,
                        benchmark: null,
                        workloadParameters: null,
                        annotations,
                        controls,
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        params: null,
                        resourceAttachments: {
                            directResources: [],
                            resourceGraph: [],
                            runtimeGraphs: []
                        },
                        suitePath: [
                            { definitionLocations: [ { kind: 'unknown' as const } ], title: 'integration' }
                        ],
                        testFamily: 'integration',
                        title: 'first'
                    }
                ]
            }
        ],
        orphans: [],
        root: { annotations, controls, title: 'worker pool' }
    };
}

export function createCollectedPlanWithMissingResult(): CollectedRunPlan {
    const collectedPlan = createCollectedPlan();
    const firstFile = collectedPlan.files[0];

    if (firstFile === undefined) {
        throw new Error('Collected plan fixture requires a file.');
    }

    return {
        ...collectedPlan,
        defined: 2,
        files: [
            {
                ...firstFile,
                cases: [
                    ...firstFile.cases,
                    {
                        implementationDeclaration: null,

                        skipReason: null,
                        property: null,
                        benchmark: null,
                        workloadParameters: null,
                        annotations,
                        controls,
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        params: null,
                        resourceAttachments: {
                            directResources: [],
                            resourceGraph: [],
                            runtimeGraphs: []
                        },
                        suitePath: [
                            { definitionLocations: [ { kind: 'unknown' as const } ], title: 'integration' }
                        ],
                        testFamily: 'integration',
                        title: 'missing result'
                    }
                ]
            }
        ]
    };
}

function firstWorkUnit(): PlacementPlan['units'][number] {
    return {
        group: null,
        id: { familyVariant: null, key: integrationPath, mode: 'file', runtimes: [], workload: null },
        ...defaultUnitPolicy,
        work: [ { familyVariant: null, case: firstCaseId(), runtimes: [], workload: null } ]
    };
}

export function placementPlan(): PlacementPlan {
    return {
        assignments: [
            {
                lane: 'worker-1',
                unit: firstWorkUnit().id
            }
        ],
        lanes: [
            {
                executor: {
                    capabilities: [],
                    capacity: 1,
                    id: 'worker-1',
                    kind: 'local-worker'
                },
                id: 'worker-1'
            }
        ],
        resourceOwnership: { owners: [] },
        units: [ firstWorkUnit() ]
    };
}

export function workerPoolResolvedRun(collectedPlan: CollectedRunPlan): WorkerPoolRunRuntime['resolvedRun'] {
    return {
        collectionRunnerErrors: [],
        config: defaultRunConfig(),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        facts: {
            implementations: null,

            family: { id: 'integration', version: '1', settings: null, preparation: null, collection: null },
            adapter: null,
            benchmarkHost: null,
            benchmarkCalibration: null,
            benchmarkNormalization: null,
            benchmarkPlacement: null,
            coveragePolicy: null,
            durationHistory: null,
            cases: [],
            environment: {
                node: { arch: 'x64', platform: 'linux', version: '26.1.1' },
                projectRoot: process.cwd(),
                runtimeStateDir: '.overkill'
            },
            execution: {
                debuggedCases: [],
                failureArtifacts: defaultFailureArtifactPolicy,
                runRecords: { persist: false, reasons: [] },
                benchmarkGarbageCollection: null,
                propertyPolicy: null,
                attachments: null,
                retries: null,
                assignmentPolicy: 'case-count-balanced',
                baselineUpdateMode: 'none',
                capture: 'buffered',
                coverage: false,
                debug: { mode: 'off', selectors: [] },
                engine: { kind: 'default' },
                maxConcurrency: 5,
                dispatchPolicy: 'dynamic-lease',
                hedging: { mode: 'off' },
                hostProcess: { kind: 'direct' },
                order: 'seeded',
                placementPlan: placementPlan(),
                processModel: 'worker-pool',
                profile: 'integration',
                processUsagePolicy: {
                    budgets: {
                        activeResourceCount: null,
                        javaScriptEngineHeapBytes: null,
                        residentSetBytes: null,
                        residentSetGrowthBytesPerSecond: null
                    },
                    measure: false,
                    samplingIntervalMilliseconds: 100
                },
                scheduling: 'serial',
                testFamily: 'integration',
                timingCollection: 'summary',
                timeoutPolicy: {
                    collectionMilliseconds: 1000,
                    hardMilliseconds: 1000,
                    softMilliseconds: 500
                },
                workDistribution: { mode: 'file' },
                workerCount: { hostMaximum: 1, profileMaximum: null, requested: null, resolved: 1 },
                workerLifecycle: 'reuse',
                verbose: false
            },
            loader: { sourceMaps: false, stripMode: 'strip-only' },
            reproducibility: {
                selectedIdentities: [],
                selection: { kind: 'all' },
                seed: '42',
                shard: { index: 1, total: 1 },
                shardHashAlgorithm: 'xxh3-64-canonical-json-v1'
            }
        },
        plan: { collectedPlan, kind: 'worker-pool' },
        reporters: [],
        request: defaultRunRequest({ paths: [ integrationPath ], profile: 'integration' })
    };
}

async function emptyReporterErrors(): Promise<readonly []> {
    return [];
}

export const fakeReporterDelivery: WorkerPoolRunRuntime['reporterDelivery'] = {
    disposeReporters: emptyReporterErrors,
    reportEvent: emptyReporterErrors,
    reportResult: emptyReporterErrors
};

async function createFakeReporterDelivery(): Promise<WorkerPoolRunRuntime['reporterDelivery']> {
    return fakeReporterDelivery;
}

export function testOnlyDependency(): never {
    throw new Error('Test fixture dependency is not configured.');
}

export function createFakePool(maxThreads: number, isolateWorkers: boolean): CreatedWorkerPool {
    return {
        destroy: Promise.resolve.bind(Promise),
        options: { isolateWorkers, maxThreads },
        async run() {
            throw new Error('Fake worker pool did not receive a task implementation.');
        }
    };
}

const createFakeWorkerPool: RunOrchestratorDependencies['createWorkerPool'] = function createFakeWorkerPool(options) {
    return createFakePool(options.workerCount, options.workerLifecycle === 'fresh-worker-per-unit');
};

export function fakeDependencies(): WorkerPoolRunRuntime['dependencies'] {
    return {
        ...fakeWorkerPoolRuntimeDependencies(),
        createWorkerPool: createFakeWorkerPool,
        reporterDispatcher: {
            createDelivery: createFakeReporterDelivery,
            async trackRunnerErrorDelivery(work) {
                return {
                    deliveredRunnerErrors: [],
                    result: await work(),
                    undeliveredRunnerErrors: []
                };
            }
        }
    };
}

export function fakeWorkerRuntime(collectedPlan: CollectedRunPlan): WorkerPoolRunRuntime {
    const taskResults: RunResult[] = [];
    const placementTrace = createWorkerPoolPlacementTraceRecorder();
    return {
        attachments: null,
        activeTasks: new Set(),
        collectedPlan,
        collectionRunnerErrors: [],
        dependencies: fakeDependencies(),
        destroyPool: true,
        async finalizeResult(completion) {
            return completion.result;
        },
        pool: createFakePool(1, false),
        poolProcessUsageTracker: null,
        placementTrace,
        get placementTraceEntries() {
            return placementTrace.entries();
        },
        previousPoolSample: createStoredRunValue<
            ReturnType<WorkerPoolRunRuntime['previousPoolSample']['read']>
        >(null),
        reporterDelivery: fakeReporterDelivery,
        reporterEvents: {
            add() {
                return undefined;
            },
            async wait() {
                return undefined;
            }
        },
        resolvedRun: workerPoolResolvedRun(collectedPlan),
        runState: createSupervisedRunState('first-failure-and-final'),
        taskResults,
        terminalFailure: createStoredRunValue(false),
        lifecycle: { endpoint: null, token: 'fake-worker-runtime' }
    };
}

export function createTaskRun(state: SupervisedRunState): WorkerPoolTaskRun {
    const timeout = createStoredRunValue<ReturnType<RunOrchestratorDependencies['wallClock']['setTimeout']> | null>(
        null
    );

    return {
        activeAttempt: createStoredRunValue<ActiveAttempt>(null),
        bufferedReporterEvents: createReporterEventBuffer(),
        completedAttempts: new Set(),
        controller: new AbortController(),
        endedByParent: createStoredRunValue(false),
        envelopeId: createStoredRunValue<BatchEnvelopeId>(null),
        includeArtifacts: createStoredRunValue(true),
        interruptionCause: createStoredRunValue<
            ReturnType<WorkerPoolTaskRun['interruptionCause']['read']>
        >(null),
        lane: 'worker-1',
        leaseKind: 'primary',
        members: [ { attempt: 'attempt-1', traceUnit: firstWorkUnit().id, unit: firstWorkUnit() } ],
        reporterEventsBuffered: false,
        requeuePendingCases: createStoredRunValue(false),
        state,
        startedCases: new Set(),
        timeout,
        traceUnit: firstWorkUnit().id,
        unit: firstWorkUnit(),
        workerId: createStoredRunValue<ReturnType<WorkerPoolTaskRun['workerId']['read']>>(null)
    };
}

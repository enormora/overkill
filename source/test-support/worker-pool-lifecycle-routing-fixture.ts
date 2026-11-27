import { defaultFailureArtifactPolicy } from '../packages/engine/engine.entry-point.ts';
import {
    emptyWorkUnitResourceConstraints,
    type CollectedRunPlan,
    type PlacementPlan,
    type ResolvedRun
} from '../run/run-types.ts';
import type { CreatedWorkerPool, WorkerPoolCreationOptions } from '../run/run-orchestrator-dependencies.ts';
import type { WorkerPoolRunRuntime } from '../run/worker-pool-runtime.ts';
import { createWorkerPoolPlacementPlan } from '../run/worker-pool-placement-planning.ts';
import { defaultRunConfig, defaultRunRequest } from './run-command-factory.ts';
import { fakeWorkerPoolRuntimeDependencies } from './worker-pool-runtime-fixtures.ts';

export type WorkerLifecycle = WorkerPoolCreationOptions['workerLifecycle'];

export type CreatedWorkerPools = {
    readonly push: (...options: readonly WorkerPoolCreationOptions[]) => number;
};

type RoutedLifecycles = {
    readonly push: (...workerLifecycle: readonly WorkerLifecycle[]) => number;
};

const integrationPath = 'source/integration-tests/runtime/fixtures/passing.test.ts';

const secondIntegrationPath = 'source/integration-tests/runtime/fixtures/delayed-pass.test.ts';

const annotations = { ownership: [], tags: [] };

const controls = { capture: null, duplicateExecution: null, timeoutMilliseconds: null };

function collectedCase(title: string): CollectedRunPlan['files'][number]['cases'][number] {
    return {
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
        suitePath: title === 'first'
            ? [ { definitionLocations: [ { kind: 'unknown' as const } ], title: 'integration' } ]
            : [],
        testFamily: 'integration',
        title
    };
}

function collectedPlan(): CollectedRunPlan {
    return {
        implementations: null,

        family: null,
        defined: 2,
        discoveredFiles: [],
        files: [
            { cases: [ collectedCase('first') ], file: integrationPath },
            { cases: [ collectedCase('second') ], file: secondIntegrationPath }
        ],
        orphans: [],
        root: { annotations, controls, title: 'worker pool' }
    };
}

function baseResolvedRun(): ResolvedRun {
    const plan = collectedPlan();

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
                placementPlan: createWorkerPoolPlacementPlan({
                    runConstraints: emptyWorkUnitResourceConstraints,
                    assignmentPolicy: 'case-count-balanced',
                    availableParallelism: 2,
                    profileMaximumWorkers: null,
                    requestedWorkers: null,
                    fileSetForFile() {
                        return null;
                    },
                    order: 'plan',
                    seed: { value: 42n },
                    selectedPlan: plan,
                    scheduling: 'serial',
                    workDistribution: { mode: 'file' },
                    workerLifecycle: 'reuse'
                }),
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
                workerCount: {
                    hostMaximum: 2,
                    profileMaximum: null,
                    requested: null,
                    resolved: 1
                },
                workDistribution: { mode: 'file' },
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
        plan: { collectedPlan: plan, kind: 'worker-pool' },
        reporters: [],
        request: defaultRunRequest({ paths: [ integrationPath ], profile: 'integration' })
    };
}

function workerLane(id: string): PlacementPlan['lanes'][number] {
    return {
        executor: {
            capabilities: [],
            capacity: 1,
            id,
            kind: 'local-worker'
        },
        id
    };
}

export function mixedLifecycleResolvedRun(): ResolvedRun {
    const resolvedRun = baseResolvedRun();
    const { placementPlan } = resolvedRun.facts.execution;

    if (placementPlan === null) {
        throw new Error('Mixed lifecycle test requires a placement plan.');
    }

    const [ firstUnit, secondUnit ] = placementPlan.units;

    if (firstUnit === undefined || secondUnit === undefined) {
        throw new Error('Mixed lifecycle fixture requires two work units.');
    }

    return {
        ...resolvedRun,
        facts: {
            ...resolvedRun.facts,
            execution: {
                ...resolvedRun.facts.execution,
                placementPlan: {
                    assignments: [
                        { lane: 'worker-1', unit: firstUnit.id },
                        { lane: 'worker-2', unit: secondUnit.id }
                    ],
                    lanes: [
                        placementPlan.lanes[0] ?? workerLane('worker-1'),
                        workerLane('worker-2')
                    ],
                    resourceOwnership: { owners: [] },
                    units: [
                        { ...firstUnit, workerLifecycle: 'reuse' },
                        { ...secondUnit, workerLifecycle: 'fresh-worker-per-unit' }
                    ]
                }
            }
        }
    };
}

function fakePool(
    options: WorkerPoolCreationOptions,
    routedLifecycles: RoutedLifecycles,
    routedHostOutputSinks: RoutedLifecycles
): CreatedWorkerPool {
    return {
        async destroy() {
            return undefined;
        },
        options: {
            isolateWorkers: options.workerLifecycle === 'fresh-worker-per-unit',
            maxThreads: options.workerCount
        },
        async run() {
            routedLifecycles.push(options.workerLifecycle);

            return options.workerLifecycle;
        },
        setHostOutputSink() {
            routedHostOutputSinks.push(options.workerLifecycle);
        }
    };
}

export function fakeDependencies(
    createdWorkerPools: CreatedWorkerPools,
    routedLifecycles: RoutedLifecycles,
    routedHostOutputSinks: RoutedLifecycles
): WorkerPoolRunRuntime['dependencies'] {
    return {
        ...fakeWorkerPoolRuntimeDependencies(),
        createWorkerPool(options) {
            createdWorkerPools.push(options);

            return fakePool(options, routedLifecycles, routedHostOutputSinks);
        }
    };
}

import { defaultFailureArtifactPolicy } from '../packages/engine/engine.entry-point.ts';
import { emptyWorkUnitResourceConstraints } from '../run/run-types.ts';
import type { WorkerPoolRunRuntime } from '../run/worker-pool-runtime.ts';
import { createWorkerPoolPlacementPlan } from '../run/worker-pool-placement-planning.ts';
import { defaultIntegrationProfile, defaultRunConfig, defaultRunRequest } from './run-command-factory.ts';

export type CollectedRunPlan = WorkerPoolRunRuntime['collectedPlan'];

export type ResolvedRun = WorkerPoolRunRuntime['resolvedRun'];

const integrationPath = 'source/integration-tests/runtime/fixtures/passing.test.ts';

const annotations = { ownership: [], tags: [] };

const controls = { capture: null, duplicateExecution: null, timeoutMilliseconds: null };

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

export function workerPoolResolvedRun(collectedPlan: CollectedRunPlan): ResolvedRun {
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
                    selectedPlan: collectedPlan,
                    scheduling: 'serial',
                    workDistribution: { mode: 'file' },
                    workerLifecycle: 'reuse'
                }),
                processModel: 'worker-pool',
                profile: 'integration',
                processUsagePolicy: defaultIntegrationProfile({}).processUsage,
                scheduling: 'serial',
                testFamily: 'integration',
                timingCollection: 'summary',
                timeoutPolicy: {
                    collectionMilliseconds: 1000,
                    hardMilliseconds: 1000,
                    softMilliseconds: 500
                },
                workDistribution: { mode: 'file' },
                workerCount: {
                    hostMaximum: 2,
                    profileMaximum: null,
                    requested: null,
                    resolved: 1
                },
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

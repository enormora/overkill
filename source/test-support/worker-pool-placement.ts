import {
    defaultFailureArtifactPolicy,
    type CaseId,
    type TestPlan,
    type TestBodyExecutionRequirementSummary
} from '../packages/engine/engine.entry-point.ts';

import { defaultRunEngine } from '../run/default-run-engine.ts';

import { emptyWorkUnitResourceConstraints, type CollectedRunPlan } from '../run/run-types.ts';

import type { WorkerPoolRunRuntime } from '../run/worker-pool-runtime.ts';

import { defaultRunConfig, defaultRunRequest, defaultIntegrationProfile } from './run-command-factory.ts';

export const integrationPath = 'source/integration-tests/integration/fixtures/passing.test.ts';

export const secondIntegrationPath = 'source/integration-tests/integration/fixtures/delayed-pass.test.ts';

const annotations = { ownership: [], tags: [] };

const controls = { capture: null, duplicateExecution: null, timeoutMilliseconds: null };

export function testFileHref(path: string): string {
    const url = new URL(path, new URL('../run/', import.meta.url));

    return url.href;
}

function collectedCase(
    title: string,
    suitePath: CollectedRunPlan['files'][number]['cases'][number]['suitePath']
): CollectedRunPlan['files'][number]['cases'][number] {
    return {
        implementationDeclaration: null,

        skipReason: null,
        property: null,
        benchmark: null,
        workloadParameters: null,
        annotations,
        controls,
        definitionLocations: [ { kind: 'unknown' as const } ],
        params: title === 'second' ? '["slow"]' : null,
        resourceAttachments: {
            directResources: [],
            resourceGraph: [],
            runtimeGraphs: []
        },
        suitePath,
        testFamily: 'integration',
        title
    };
}

export function createCollectedPlan(): CollectedRunPlan {
    return {
        implementations: null,

        family: null,
        defined: 2,
        discoveredFiles: [],
        files: [
            {
                file: integrationPath,
                cases: [
                    collectedCase('first', [
                        { definitionLocations: [ { kind: 'unknown' as const } ], title: 'integration' }
                    ])
                ]
            },
            {
                file: secondIntegrationPath,
                cases: [ collectedCase('second', []) ]
            }
        ],
        orphans: [],
        root: {
            annotations,
            controls,
            title: 'worker pool'
        }
    };
}

const defaultUnitPolicy = {
    order: 'plan',
    scheduling: 'concurrent',
    workerLifecycle: 'reuse'
} as const;

type ResolvedRun = WorkerPoolRunRuntime['resolvedRun'];

type PlacementPlan = NonNullable<ResolvedRun['facts']['execution']['placementPlan']>;

type WorkUnit = PlacementPlan['units'][number];

const selectedShard = 1n;
const defaultShard = 0n;
export const shardBySecondPath = {
    hash(value: string): bigint {
        return value.includes(secondIntegrationPath) ? selectedShard : defaultShard;
    }
};

export function createConstrainedPlan(requirements: readonly TestBodyExecutionRequirementSummary[]): CollectedRunPlan {
    const plan = createCollectedPlan();
    const firstFile = plan.files[0];
    const firstCase = firstFile?.cases[0];

    if (firstFile === undefined || firstCase === undefined) {
        throw new Error('Constrained planning fixture requires its first case.');
    }

    return {
        ...plan,
        files: [
            {
                ...firstFile,
                cases: [
                    {
                        ...firstCase,
                        resourceAttachments: {
                            ...firstCase.resourceAttachments,
                            resourceGraph: [
                                {
                                    workload: 'independent' as const,
                                    dependencies: [],
                                    handleTransport: 'local',
                                    name: 'database',
                                    requirements,
                                    scenarios: [],
                                    scope: 'per-case'
                                }
                            ]
                        }
                    },
                    ...firstFile.cases.slice(1)
                ]
            },
            ...plan.files.slice(1)
        ]
    };
}

function createLocalTestPlan(): TestPlan {
    const testNode = defaultRunEngine.createTestCase({
        annotations: {},
        body(scope) {
            scope.assert.true(true);
            return scope.assert.collect();
        },
        controls: {},
        definitionLocations: [ { kind: 'unknown' as const } ],
        title: 'local'
    });

    return defaultRunEngine.createTestPlanFromTestFiles({
        files: [ { file: integrationPath, testNode } ],
        root: {
            annotations: {},
            controls: {},
            title: 'worker pool placement'
        }
    });
}

function createResolvedRun(plan: ResolvedRun['plan']): ResolvedRun {
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
                placementPlan: null,
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
                    hostMaximum: 1,
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
        plan,
        reporters: [],
        request: defaultRunRequest({ paths: [ integrationPath ], profile: 'integration' })
    };
}

export function workerPoolResolvedRun(collectedPlan: CollectedRunPlan): ResolvedRun {
    return createResolvedRun({ collectedPlan, kind: 'worker-pool' });
}

export function localResolvedRun(): ResolvedRun {
    return createResolvedRun({ kind: 'local', testPlan: createLocalTestPlan() });
}

function firstCaseId(): CaseId {
    return {
        file: integrationPath,
        params: null,
        suite: [ 'integration' ],
        title: 'first'
    };
}

function secondCaseId(): CaseId {
    return {
        file: secondIntegrationPath,
        params: '["slow"]',
        suite: [],
        title: 'second'
    };
}

export function firstWorkUnit(): WorkUnit {
    return {
        group: null,
        id: { familyVariant: null, key: integrationPath, mode: 'file', runtimes: [], workload: null },
        ...defaultUnitPolicy,
        resourceConstraints: emptyWorkUnitResourceConstraints,
        work: [ { familyVariant: null, case: firstCaseId(), runtimes: [], workload: null } ]
    };
}

export function secondWorkUnit(): WorkUnit {
    return {
        group: null,
        id: { familyVariant: null, key: secondIntegrationPath, mode: 'file', runtimes: [], workload: null },
        ...defaultUnitPolicy,
        resourceConstraints: emptyWorkUnitResourceConstraints,
        work: [ { familyVariant: null, case: secondCaseId(), runtimes: [], workload: null } ]
    };
}

export function expectedPlacementPlan(): PlacementPlan {
    const firstUnit = firstWorkUnit();
    const secondUnit = secondWorkUnit();

    return {
        assignments: [
            { lane: 'worker-1', unit: firstUnit.id },
            { lane: 'worker-2', unit: secondUnit.id }
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
            },
            {
                executor: {
                    capabilities: [],
                    capacity: 1,
                    id: 'worker-2',
                    kind: 'local-worker'
                },
                id: 'worker-2'
            }
        ],
        resourceOwnership: { owners: [] },
        units: [ firstUnit, secondUnit ]
    };
}

export function fileSetForFile(file: string): string | null {
    const files = new Map([
        [ integrationPath, 'fast' ],
        [ secondIntegrationPath, 'slow' ]
    ]);

    return files.get(file) ?? null;
}

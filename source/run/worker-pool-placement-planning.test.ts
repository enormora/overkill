import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type CaseId,
    type TestPlan,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { emptyWorkUnitResourceConstraints } from './run-types.ts';
import type { RunShardHasher } from './run-sharding.ts';
import {
    createWorkerPoolPlacementPlan,
    createWorkerPoolPlacementResolution
} from './worker-pool-placement-planning.ts';
import {
    runStartTimeFromMilliseconds,
    workerPoolCollectedPlan,
    type WorkerPoolRunRuntime
} from './worker-pool-runtime.ts';
import {
    workUnitsFromCollectedPlan
} from './work-unit-planning.ts';

const integrationPath = 'source/integration-tests/run/fixtures/passing.test.ts';
const secondIntegrationPath = 'source/integration-tests/run/fixtures/delayed-pass.test.ts';
const annotations = { ownership: [], tags: [] };
const controls = { capture: null, timeoutMilliseconds: null };
const defaultUnitPolicy = {
    order: 'plan',
    scheduling: 'concurrent',
    workerLifecycle: 'reuse'
} as const;
type CollectedRunPlan = WorkerPoolRunRuntime['collectedPlan'];
type ResolvedRun = WorkerPoolRunRuntime['resolvedRun'];
type PlacementPlan = NonNullable<ResolvedRun['facts']['execution']['placementPlan']>;
type WorkUnit = PlacementPlan['units'][number];

const shardBySecondPath: RunShardHasher = {
    hash(value) {
        return value.includes(secondIntegrationPath) ? 1n : 0n;
    }
};

function collectedCase(
    title: string,
    suitePath: CollectedRunPlan['files'][number]['cases'][number]['suitePath']
): CollectedRunPlan['files'][number]['cases'][number] {
    return {
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

function createCollectedPlan(): CollectedRunPlan {
    return {
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
            durationHistory: null,
            cases: [],
            environment: {
                node: { arch: 'x64', platform: 'linux', version: '26.1.1' },
                projectRoot: process.cwd(),
                runtimeStateDir: '.overkill'
            },
            execution: {
                assignmentPolicy: 'case-count-balanced',
                baselineUpdateMode: 'none',
                capture: 'buffered',
                debug: { mode: 'off', selectors: [] },
                engine: { kind: 'default' },
                dispatchPolicy: 'dynamic-lease',
                hostProcess: { kind: 'direct' },
                order: 'seeded',
                placementPlan: null,
                processModel: 'worker-pool',
                profile: 'integration',
                resourceUsagePolicy: {
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
                timeoutPolicy: {
                    collectionMilliseconds: 1000,
                    hardMilliseconds: 1000,
                    softMilliseconds: 500
                },
                workDistribution: { mode: 'file' },
                workerLifecycle: 'reuse',
                verbose: false
            },
            loader: { sourceMaps: false, stripMode: 'strip-only' },
            reproducibility: {
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

function workerPoolResolvedRun(collectedPlan: CollectedRunPlan): ResolvedRun {
    return createResolvedRun({ collectedPlan, kind: 'worker-pool' });
}

function localResolvedRun(): ResolvedRun {
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

function firstWorkUnit(): WorkUnit {
    return {
        group: null,
        id: { key: integrationPath, mode: 'file', runtimes: [], workload: null },
        ...defaultUnitPolicy,
        resourceConstraints: emptyWorkUnitResourceConstraints,
        work: [ { case: firstCaseId(), runtimes: [], workload: null } ]
    };
}

function secondWorkUnit(): WorkUnit {
    return {
        group: null,
        id: { key: secondIntegrationPath, mode: 'file', runtimes: [], workload: null },
        ...defaultUnitPolicy,
        resourceConstraints: emptyWorkUnitResourceConstraints,
        work: [ { case: secondCaseId(), runtimes: [], workload: null } ]
    };
}

function expectedPlacementPlan(): PlacementPlan {
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
        units: [ firstUnit, secondUnit ]
    };
}

function fileSetForFile(file: string): string | null {
    const files = new Map([
        [ integrationPath, 'fast' ],
        [ secondIntegrationPath, 'slow' ]
    ]);

    return files.get(file) ?? null;
}

function assertWorkerPoolPlanHelpers(scope: OverkillScope, collectedPlan: CollectedRunPlan): void {
    scope.assert.equal(runStartTimeFromMilliseconds(0), '1970-01-01T00:00:00.000Z');
    scope.assert.equal(workerPoolCollectedPlan(workerPoolResolvedRun(collectedPlan)), collectedPlan);
    scope.assert.throws(function readLocalPlan() {
        workerPoolCollectedPlan(localResolvedRun());
    }, { message: 'Worker-pool execution requires a worker-pool collected plan.' });
}

function assertWorkUnitPlanning(scope: OverkillScope, collectedPlan: CollectedRunPlan): void {
    scope.assert.deepEqual(
        workUnitsFromCollectedPlan({
            fileSetForFile,
            order: 'plan',
            seed: { value: 1n },
            selectedPlan: collectedPlan,
            scheduling: 'concurrent',
            workDistribution: { mode: 'file' },
            workerLifecycle: 'reuse'
        }),
        [ firstWorkUnit(), secondWorkUnit() ]
    );
    scope.assert.deepEqual(
        workUnitsFromCollectedPlan({
            fileSetForFile,
            order: 'plan',
            seed: { value: 1n },
            selectedPlan: collectedPlan,
            scheduling: 'concurrent',
            shard: { index: 2, total: 2 },
            shardHasher: shardBySecondPath,
            workDistribution: { mode: 'file' },
            workerLifecycle: 'reuse'
        }),
        [ secondWorkUnit() ]
    );
}

function assertPlacementPlanning(scope: OverkillScope, collectedPlan: CollectedRunPlan): void {
    scope.assert.deepEqual(
        createWorkerPoolPlacementPlan({
            assignmentPolicy: 'case-count-balanced',
            availableParallelism: 3,
            fileSetForFile,
            order: 'plan',
            seed: { value: 1n },
            selectedPlan: collectedPlan,
            scheduling: 'concurrent',
            workDistribution: { mode: 'file' },
            workerLifecycle: 'reuse'
        }),
        expectedPlacementPlan()
    );
    scope.assert.deepEqual(
        createWorkerPoolPlacementResolution({
            assignmentPolicy: 'duration-history-balanced',
            availableParallelism: 3,
            durationHistoryIndex: null,
            fileSetForFile,
            nowMilliseconds: 0,
            order: 'plan',
            seed: { value: 1n },
            selectedPlan: collectedPlan,
            scheduling: 'concurrent',
            workDistribution: { mode: 'file' },
            workerLifecycle: 'reuse'
        }),
        {
            durationHistory: null,
            placementPlan: expectedPlacementPlan()
        }
    );
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-placement-planning.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool placement planning creates file units and placements',
            body(scope: OverkillScope) {
                const collectedPlan = createCollectedPlan();

                assertWorkerPoolPlanHelpers(scope, collectedPlan);
                assertWorkUnitPlanning(scope, collectedPlan);
                assertPlacementPlanning(scope, collectedPlan);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

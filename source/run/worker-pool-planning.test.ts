import { createDeterministicWallClock } from '@enormora/wall-clock';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type CaseId,
    type TestPlan,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    defaultIntegrationProfile,
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import {
    createSupervisedCollectCommand,
    createWorkerPoolCommand
} from './run-isolated-command.ts';
import {
    runStartTimeFromMilliseconds,
    workerPoolCollectedPlan,
    type WorkerPoolRunRuntime
} from './worker-pool-runtime.ts';
import {
    collectedRunCaseEntriesFromWorkUnits,
    createWorkerPoolPlacementPlan,
    workUnitsFromCollectedPlan
} from './work-unit-planning.ts';
import {
    createEmptyAssignmentResult,
    selectedAssignedCases,
    sendCollectedPlan
} from './worker-pool-worker-plan.ts';
import type { RunCommand } from './run-types.ts';

const integrationPath = 'source/integration-tests/run/fixtures/passing.test.ts';
const secondIntegrationPath = 'source/integration-tests/run/fixtures/delayed-pass.test.ts';
const annotations = { ownership: [], tags: [] };
const controls = { capture: null, timeoutMilliseconds: null };
type CollectedRunPlan = WorkerPoolRunRuntime['collectedPlan'];
type ResolvedRun = WorkerPoolRunRuntime['resolvedRun'];
type PlacementPlan = NonNullable<ResolvedRun['facts']['execution']['placementPlan']>;
type RunProfileConfig = RunCommand['config']['profiles'][string];
type WorkUnit = PlacementPlan['units'][number];
type DiscoveredFile = {
    readonly file: string;
    readonly fileSet: string | null;
    readonly href: string;
    readonly path: string;
};
type DiscoveredFiles = readonly [DiscoveredFile, ...readonly DiscoveredFile[]];

function createPlanningTestPlan(): TestPlan {
    const firstCase = defaultRunEngine.createTestCase({
        annotations: {},
        controls: {},
        definitionLocations: [ { kind: 'unknown' as const } ],
        title: 'first',
        body(scope) {
            scope.assert.true(true);
            return scope.assert.collect();
        }
    });
    const secondCase = defaultRunEngine.createTestCase({
        annotations: {},
        controls: {},
        definitionLocations: [ { kind: 'unknown' as const } ],
        title: 'second',
        body(scope) {
            scope.assert.true(true);
            return scope.assert.collect();
        }
    });

    return defaultRunEngine.createTestPlanFromTestFiles({
        files: [
            {
                file: integrationPath,
                testNode: defaultRunEngine.createSuite({
                    annotations: {},
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    title: 'integration',
                    children: [ firstCase, secondCase ]
                })
            }
        ],
        root: {
            annotations: {},
            controls: {},
            title: 'worker pool planning'
        }
    });
}

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

function collectedPlanWithFiles(files: CollectedRunPlan['files']): CollectedRunPlan {
    return {
        ...createCollectedPlan(),
        defined: files.reduce(function countCases(total, file) {
            return total + file.cases.length;
        }, 0),
        files
    };
}

function generatedCollectedFile(index: number): CollectedRunPlan['files'][number] {
    const file = `source/integration-tests/run/fixtures/generated-${index}.test.ts`;

    return {
        file,
        cases: [
            {
                ...collectedCase(`case-${index}`, []),
                params: null
            }
        ]
    };
}

function createRunCommand(profile: RunProfileConfig): RunCommand {
    return {
        config: defaultRunConfig({
            profiles: {
                integration: profile,
                microtest: defaultMicrotestProfile()
            }
        }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            capture: 'live',
            paths: [ integrationPath ],
            profile: 'integration',
            resourceBudgetOverrides: {
                activeResourceCount: 7,
                javaScriptEngineHeapBytes: null,
                residentSetBytes: null,
                residentSetGrowthBytesPerSecond: null
            },
            measureResourceUsage: true,
            resourceUsageSamplingIntervalMilliseconds: 13
        })
    };
}

function createResolvedRun(plan: ResolvedRun['plan']): ResolvedRun {
    return {
        collectionRunnerErrors: [],
        config: defaultRunConfig(),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        facts: {
            cases: [],
            environment: {
                node: { arch: 'x64', platform: 'linux', version: '26.1.1' },
                projectRoot: process.cwd(),
                runtimeStateDir: '.overkill'
            },
            execution: {
                baselineUpdateMode: 'none',
                capture: 'buffered',
                debug: { mode: 'off', selectors: [] },
                engine: { kind: 'default' },
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
                shard: { index: 0, total: 1 }
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
        id: { key: integrationPath, mode: 'file', runtime: null, workload: null },
        work: [ { case: firstCaseId(), runtime: null, workload: null } ]
    };
}

function secondWorkUnit(): WorkUnit {
    return {
        group: null,
        id: { key: secondIntegrationPath, mode: 'file', runtime: null, workload: null },
        work: [ { case: secondCaseId(), runtime: null, workload: null } ]
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

function unknownWorkUnit(): WorkUnit {
    return {
        ...firstWorkUnit(),
        work: [
            {
                case: { ...firstCaseId(), title: 'missing' },
                runtime: null,
                workload: null
            }
        ]
    };
}

function manyCollectedFiles(): CollectedRunPlan['files'] {
    return Array.from({ length: 10 }, function createFile(_value, index) {
        return generatedCollectedFile(index);
    });
}

function discoveredFiles(): DiscoveredFiles {
    return [
        { file: integrationPath, fileSet: null, href: 'virtual:first', path: integrationPath },
        { file: secondIntegrationPath, fileSet: 'slow', href: 'virtual:second', path: secondIntegrationPath }
    ];
}

function fileSetForFile(file: string): string | null {
    const files = new Map([
        [ integrationPath, 'fast' ],
        [ secondIntegrationPath, 'slow' ]
    ]);

    return files.get(file) ?? null;
}

function requiredSecondCase(testPlan: TestPlan): TestPlan['cases'][number] {
    const secondCase = testPlan.cases[1];

    if (secondCase === undefined) {
        throw new Error('Planning fixture must have two cases.');
    }

    return secondCase;
}

function assertPlanningHelpers(scope: OverkillScope, testPlan: TestPlan): void {
    const wallClock = createDeterministicWallClock();
    const selected = selectedAssignedCases(testPlan, [ requiredSecondCase(testPlan).id ]);
    wallClock.advanceByMilliseconds(150);

    const emptyResult = createEmptyAssignmentResult(testPlan, wallClock, 100);
    const collection = sendCollectedPlan({ runnerErrors: [], testPlan });

    scope.assert.equal(selected.cases[0].id.title, 'second');
    scope.assert.equal(emptyResult.result.summary.planned, 2);
    scope.assert.deepEqual(emptyResult.result.perTest, []);
    scope.assert.equal(collection.collectedPlan.files[0]?.file, integrationPath);
}

function assertEmptyCollectedFiles(scope: OverkillScope): void {
    const plan = collectedPlanWithFiles([
        { cases: [], file: integrationPath },
        createCollectedPlan().files[1] ?? generatedCollectedFile(1)
    ]);

    scope.assert.deepEqual(workUnitsFromCollectedPlan(plan), [ secondWorkUnit() ]);
}

function assertWorkerCountBounds(scope: OverkillScope): void {
    const emptyPlan = collectedPlanWithFiles([]);
    const manyPlan = collectedPlanWithFiles(manyCollectedFiles());
    const singleWorkerPlan = createWorkerPoolPlacementPlan({
        availableParallelism: 1,
        fileSetForFile,
        order: 'plan',
        seed: { value: 1n },
        selectedPlan: manyPlan,
        workDistribution: { mode: 'file' }
    });
    const cappedWorkerPlan = createWorkerPoolPlacementPlan({
        availableParallelism: 99,
        fileSetForFile,
        order: 'plan',
        seed: { value: 1n },
        selectedPlan: manyPlan,
        workDistribution: { mode: 'file' }
    });

    scope.assert.deepEqual(
        createWorkerPoolPlacementPlan({
            availableParallelism: 8,
            fileSetForFile,
            order: 'plan',
            seed: { value: 1n },
            selectedPlan: emptyPlan,
            workDistribution: { mode: 'file' }
        }),
        { assignments: [], lanes: [], units: [] }
    );
    scope.assert.equal(singleWorkerPlan.lanes.length, 1);
    scope.assert.equal(cappedWorkerPlan.lanes.length, 8);
}

function assertUnknownWorkReferences(scope: OverkillScope): void {
    scope.assert.throws(function readUnknownWork() {
        collectedRunCaseEntriesFromWorkUnits(createCollectedPlan(), [ unknownWorkUnit() ]);
    }, { message: 'Placement plan referenced an unknown collected case.' });
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-planning.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool planning helpers preserve selected cases and empty assignments',
            body(scope: OverkillScope) {
                const testPlan = createPlanningTestPlan();

                assertPlanningHelpers(scope, testPlan);
                scope.assert.throws(function selectMissingCase() {
                    selectedAssignedCases(testPlan, [
                        { file: integrationPath, params: null, suite: [], title: 'missing' }
                    ]);
                }, { message: 'Worker-pool test plan did not match assigned case identities.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool planning covers empty files, worker limits, and stale work',
            body(scope: OverkillScope) {
                assertEmptyCollectedFiles(scope);
                assertWorkerCountBounds(scope);
                assertUnknownWorkReferences(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool planning creates file work units and round-robin placement',
            body(scope: OverkillScope) {
                const collectedPlan = createCollectedPlan();
                const workerPoolRun = workerPoolResolvedRun(collectedPlan);
                const localRun = createResolvedRun({
                    kind: 'local',
                    testPlan: createPlanningTestPlan()
                });

                scope.assert.equal(runStartTimeFromMilliseconds(0), '1970-01-01T00:00:00.000Z');
                scope.assert.equal(workerPoolCollectedPlan(workerPoolRun), collectedPlan);
                scope.assert.deepEqual(
                    workUnitsFromCollectedPlan(collectedPlan),
                    [ firstWorkUnit(), secondWorkUnit() ]
                );
                scope.assert.deepEqual(
                    createWorkerPoolPlacementPlan({
                        availableParallelism: 3,
                        fileSetForFile,
                        order: 'plan',
                        seed: { value: 1n },
                        selectedPlan: collectedPlan,
                        workDistribution: { mode: 'file' }
                    }),
                    expectedPlacementPlan()
                );
                scope.assert.throws(function readLocalPlan() {
                    workerPoolCollectedPlan(localRun);
                }, { message: 'Worker-pool execution requires a worker-pool collected plan.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'isolated command builders map integration profiles to worker commands',
            body(scope: OverkillScope) {
                const profile = defaultIntegrationProfile({
                    execution: { processModel: 'worker-pool', scheduling: 'serial' },
                    files: { exclude: [], include: [ integrationPath ] },
                    timeouts: { collectionMilliseconds: 17, hardMilliseconds: 23, softMilliseconds: 19 }
                });
                const command = createRunCommand(profile);

                scope.assert.deepEqual(
                    createSupervisedCollectCommand(command, profile, discoveredFiles()).capabilityRestrictions,
                    {
                        mode: 'disabled'
                    }
                );
                scope.assert.deepEqual(createWorkerPoolCommand(command, profile, discoveredFiles()).paths, [
                    integrationPath,
                    secondIntegrationPath
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

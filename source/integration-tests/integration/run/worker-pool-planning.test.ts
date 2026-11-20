import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';
import { setImmediate as scheduleImmediate } from 'node:timers';

import type { CaseId, TestPlan } from '../../../packages/engine/engine.entry-point.ts';
import { defaultRunEngine } from '../../../run/default-run-engine.ts';
import { emptyWorkUnitResourceConstraints } from '../../../run/run-types.ts';
import type { WorkerPoolRunRuntime } from '../../../run/worker-pool-runtime.ts';
import {
    collectedRunCaseEntriesFromWorkUnits,
    createWorkerPoolPlacementPlan
} from '../../../run/worker-pool-placement-planning.ts';
import { workUnitsFromCollectedPlan } from '../../../run/work-unit-planning.ts';
import {
    createEmptyAssignmentResult,
    runObservedWorkerCollection,
    selectedAssignedCases,
    sendCollectedPlan
} from '../../../run/worker-pool-worker-plan.ts';

const integrationPath = 'source/integration-tests/integration/fixtures/passing.test.ts';
const secondIntegrationPath = 'source/integration-tests/integration/fixtures/delayed-pass.test.ts';
const annotations = { ownership: [], tags: [] };
const controls = { capture: null, duplicateExecution: null, timeoutMilliseconds: null };
const defaultUnitPolicy = {
    order: 'plan',
    scheduling: 'concurrent',
    workerLifecycle: 'reuse'
} as const;
type CollectedRunPlan = WorkerPoolRunRuntime['collectedPlan'];
type ResolvedRun = WorkerPoolRunRuntime['resolvedRun'];
type PlacementPlan = NonNullable<ResolvedRun['facts']['execution']['placementPlan']>;
type WorkUnit = PlacementPlan['units'][number];

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

function createCollectedPlan(): CollectedRunPlan {
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
    const file = `source/integration-tests/integration/fixtures/generated-${index}.test.ts`;

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
        id: { familyVariant: null, key: integrationPath, mode: 'file', runtimes: [], workload: null },
        ...defaultUnitPolicy,
        resourceConstraints: emptyWorkUnitResourceConstraints,
        work: [ { familyVariant: null, case: firstCaseId(), runtimes: [], workload: null } ]
    };
}

function secondWorkUnit(): WorkUnit {
    return {
        group: null,
        id: { familyVariant: null, key: secondIntegrationPath, mode: 'file', runtimes: [], workload: null },
        ...defaultUnitPolicy,
        resourceConstraints: emptyWorkUnitResourceConstraints,
        work: [ { familyVariant: null, case: secondCaseId(), runtimes: [], workload: null } ]
    };
}

function unknownWorkUnit(): WorkUnit {
    return {
        ...firstWorkUnit(),
        work: [
            { familyVariant: null, case: { ...firstCaseId(), title: 'missing' }, runtimes: [], workload: null }
        ]
    };
}

function manyCollectedFiles(): CollectedRunPlan['files'] {
    return Array.from({ length: 10 }, function createFile(_value, index) {
        return generatedCollectedFile(index);
    });
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

function assertPlanningHelpers(scope: TestScope, testPlan: TestPlan): void {
    const selected = selectedAssignedCases(testPlan, [ requiredSecondCase(testPlan).id ]);

    const emptyResult = createEmptyAssignmentResult();
    const collection = sendCollectedPlan({ runnerErrors: [], testPlan });

    scope.assert.equal(selected.cases[0].id.title, 'second');
    scope.assert.deepEqual(emptyResult.results, []);
    scope.assert.equal(collection.collectedPlan.files[0]?.file, integrationPath);
}

function assertEmptyCollectedFiles(scope: TestScope): void {
    const plan = collectedPlanWithFiles([
        { cases: [], file: integrationPath },
        createCollectedPlan().files[1] ?? generatedCollectedFile(1)
    ]);

    scope.assert.deepEqual(
        workUnitsFromCollectedPlan({
            runConstraints: emptyWorkUnitResourceConstraints,
            fileSetForFile,
            order: 'plan',
            seed: { value: 1n },
            selectedPlan: plan,
            scheduling: 'concurrent',
            workDistribution: { mode: 'file' },
            workerLifecycle: 'reuse'
        }),
        [ secondWorkUnit() ]
    );
}

function assertWorkerCountBounds(scope: TestScope): void {
    const emptyPlan = collectedPlanWithFiles([]);
    const manyPlan = collectedPlanWithFiles(manyCollectedFiles());
    const singleWorkerPlan = createWorkerPoolPlacementPlan({
        runConstraints: emptyWorkUnitResourceConstraints,
        assignmentPolicy: 'case-count-balanced',
        availableParallelism: 1,
        profileMaximumWorkers: null,
        requestedWorkers: null,
        fileSetForFile,
        order: 'plan',
        seed: { value: 1n },
        selectedPlan: manyPlan,
        scheduling: 'concurrent',
        workDistribution: { mode: 'file' },
        workerLifecycle: 'reuse'
    });
    const cappedWorkerPlan = createWorkerPoolPlacementPlan({
        runConstraints: emptyWorkUnitResourceConstraints,
        assignmentPolicy: 'case-count-balanced',
        availableParallelism: 99,
        profileMaximumWorkers: null,
        requestedWorkers: null,
        fileSetForFile,
        order: 'plan',
        seed: { value: 1n },
        selectedPlan: manyPlan,
        scheduling: 'concurrent',
        workDistribution: { mode: 'file' },
        workerLifecycle: 'reuse'
    });

    scope.assert.deepEqual(
        createWorkerPoolPlacementPlan({
            runConstraints: emptyWorkUnitResourceConstraints,
            assignmentPolicy: 'case-count-balanced',
            availableParallelism: 8,
            profileMaximumWorkers: null,
            requestedWorkers: null,
            fileSetForFile,
            order: 'plan',
            seed: { value: 1n },
            selectedPlan: emptyPlan,
            scheduling: 'concurrent',
            workDistribution: { mode: 'file' },
            workerLifecycle: 'reuse'
        }),
        { assignments: [], lanes: [], resourceOwnership: { owners: [] }, units: [] }
    );
    scope.assert.equal(singleWorkerPlan.lanes.length, 1);
    scope.assert.equal(cappedWorkerPlan.lanes.length, 8);
}

function assertUnknownWorkReferences(scope: TestScope): void {
    scope.assert.throws(function readUnknownWork() {
        collectedRunCaseEntriesFromWorkUnits(createCollectedPlan(), [ unknownWorkUnit() ]);
    }, { message: 'Placement plan referenced an unknown collected case.' });
}

async function yieldToImmediate(): Promise<void> {
    await new Promise<void>(function resolveOnImmediate(resolve) {
        scheduleImmediate(resolve);
    });
}

function emitUnhandledRejection(message: string): void {
    process.emit('unhandledRejection', new Error(message), Promise.resolve());
}

export const testNode: TestNode = suite('Worker pool planning', [
    test('worker-pool planning helpers preserve selected cases and empty assignments', function (scope) {
        const testPlan = createPlanningTestPlan();

        assertPlanningHelpers(scope, testPlan);
        scope.assert.throws(function selectMissingCase() {
            selectedAssignedCases(testPlan, [
                { file: integrationPath, params: null, suite: [], title: 'missing' }
            ]);
        }, { message: 'Worker-pool test plan did not match assigned work identities.' });

        return scope.assert.collect();
    }),
    test('worker-pool planning covers empty files, worker limits, and stale work', function (scope) {
        assertEmptyCollectedFiles(scope);
        assertWorkerCountBounds(scope);
        assertUnknownWorkReferences(scope);

        return scope.assert.collect();
    }),
    test('worker-pool worker collection surfaces global hook failures', async function (scope) {
        await scope.assert.rejects(async function collectWithGlobalFailure() {
            await runObservedWorkerCollection(async function collectWorkerPlan() {
                emitUnhandledRejection('worker collection failed');
                await yieldToImmediate();
            });
        }, { message: 'Unhandled rejection: worker collection failed' });

        return scope.assert.collect();
    })
]);

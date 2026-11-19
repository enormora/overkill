import { type TestScope as OverkillScope, suite, test } from '@overkill-dev/test';

import {
    shardBySecondPath,
    createConstrainedPlan,
    workerPoolResolvedRun,
    localResolvedRun,
    firstWorkUnit,
    secondWorkUnit,
    expectedPlacementPlan,
    fileSetForFile,
    integrationPath,
    secondIntegrationPath,
    testFileHref,
    createCollectedPlan
} from '../test-support/worker-pool-placement.ts';

import { defaultRunRequest, defaultIntegrationProfile } from '../test-support/run-command-factory.ts';
import { fakeWorkerPoolRuntimeDependencies } from '../test-support/worker-pool-runtime-fixtures.ts';

import { createCollectedExecutionPlan } from './run-collected-planning.ts';
import { emptyWorkUnitResourceConstraints, type CollectedRunPlan } from './run-types.ts';
import {
    createWorkerPoolPlacementPlan,
    createWorkerPoolPlacementResolution,
    type WorkerPoolPlacementPlanInput
} from './worker-pool-placement-planning.ts';
import { runStartTimeFromMilliseconds, workerPoolCollectedPlan } from './worker-pool-runtime.ts';
import { workUnitsFromCollectedPlan } from './work-unit-planning.ts';

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
            runConstraints: emptyWorkUnitResourceConstraints,
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
            runConstraints: emptyWorkUnitResourceConstraints,
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
    const input: WorkerPoolPlacementPlanInput = {
        runConstraints: emptyWorkUnitResourceConstraints,
        assignmentPolicy: 'case-count-balanced',
        availableParallelism: 3,
        profileMaximumWorkers: null,
        requestedWorkers: null,
        fileSetForFile,
        order: 'plan',
        seed: { value: 1n },
        selectedPlan: collectedPlan,
        scheduling: 'concurrent',
        workDistribution: { mode: 'file' },
        workerLifecycle: 'reuse'
    };
    scope.assert.deepEqual(
        createWorkerPoolPlacementPlan(input),
        expectedPlacementPlan()
    );
    scope.assert.deepEqual(
        createWorkerPoolPlacementResolution({
            ...input,
            maximumWorkers: null,
            units: workUnitsFromCollectedPlan(input),
            assignmentPolicy: 'duration-history-balanced',
            durationHistoryIndex: null,
            nowMilliseconds: 0
        }),
        {
            durationHistory: null,
            placementPlan: expectedPlacementPlan(),
            workerCount: {
                hostMaximum: 3,
                profileMaximum: null,
                requested: null,
                resolved: 2
            }
        }
    );
}

export const testNode = suite('source/run/worker-pool-placement-planning.test.ts', [
    test('worker-pool placement planning creates file units and placements', function (scope: OverkillScope) {
        const collectedPlan = createCollectedPlan();

        assertWorkerPoolPlanHelpers(scope, collectedPlan);
        assertWorkUnitPlanning(scope, collectedPlan);
        assertPlacementPlanning(scope, collectedPlan);

        return scope.assert.collect();
    }),
    test('supervised planning resolves serial resource requirements', async function (scope: OverkillScope) {
        const dependencies = fakeWorkerPoolRuntimeDependencies();
        const profile = defaultIntegrationProfile({
            execution: { processModel: 'supervised-process', scheduling: 'concurrent' }
        });
        const executionPlan = await createCollectedExecutionPlan({
            projectRoot: '/project',
            benchmarkHost: null,
            collectedPlan: createConstrainedPlan([ { kind: 'serial' } ]),
            dependencies,
            durationHistoryIndex: null,
            files: [
                {
                    file: integrationPath,
                    fileSet: null,
                    href: testFileHref(integrationPath),
                    path: integrationPath
                },
                {
                    file: secondIntegrationPath,
                    fileSet: null,
                    href: testFileHref(secondIntegrationPath),
                    path: secondIntegrationPath
                }
            ],
            planKind: 'supervised',
            profile,
            request: defaultRunRequest({ paths: [ integrationPath ], profile: 'integration' })
        });

        scope.assert.equal(executionPlan.scheduling, 'serial');

        return scope.assert.collect();
    }),
    test('resource constraints resolve containing work-unit scheduling', function (scope: OverkillScope) {
        const serialUnits = workUnitsFromCollectedPlan({
            runConstraints: emptyWorkUnitResourceConstraints,
            fileSetForFile,
            order: 'plan',
            seed: { value: 1n },
            selectedPlan: createConstrainedPlan([ { kind: 'exclusive-resource', name: 'database' } ]),
            scheduling: 'concurrent',
            workDistribution: { mode: 'file' },
            workerLifecycle: 'reuse'
        });
        const singleWorkerUnits = workUnitsFromCollectedPlan({
            runConstraints: emptyWorkUnitResourceConstraints,
            fileSetForFile,
            order: 'plan',
            seed: { value: 1n },
            selectedPlan: createConstrainedPlan([ { kind: 'single-worker' } ]),
            scheduling: 'concurrent',
            workDistribution: { mode: 'file' },
            workerLifecycle: 'reuse'
        });

        scope.assert.deepEqual(
            serialUnits.map(function toScheduling(unit) {
                return unit.scheduling;
            }),
            [ 'serial', 'concurrent' ]
        );
        scope.assert.deepEqual(
            singleWorkerUnits.map(function toScheduling(unit) {
                return unit.scheduling;
            }),
            [ 'concurrent', 'concurrent' ]
        );

        return scope.assert.collect();
    })
]);

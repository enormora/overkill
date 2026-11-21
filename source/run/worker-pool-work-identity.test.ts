import { suite, test } from '@overkill-dev/test';

import type { CaseId } from '../packages/engine/engine.entry-point.ts';
import type { WorkDistribution } from '../config/types.ts';
import { collectedCasesByKey } from './supervised-run-state.ts';
import { emptyWorkUnitResourceConstraints, type CollectedRunPlan } from './run-types.ts';
import { type WorkUnitPlanningInput, workUnitsFromCollectedPlan } from './work-unit-planning.ts';

const firstPath = 'source/integration-tests/runtime/fixtures/passing.test.ts';
const secondPath = 'source/integration-tests/runtime/fixtures/delayed-pass.test.ts';
const annotations = { ownership: [], tags: [] };
const controls = { capture: null, duplicateExecution: null, timeoutMilliseconds: null };
const defaultUnitPolicy = {
    order: 'plan',
    scheduling: 'concurrent',
    workerLifecycle: 'reuse'
} as const;

function firstCaseId(): CaseId {
    return {
        file: firstPath,
        params: null,
        suite: [],
        title: 'first'
    };
}

function secondCaseId(): CaseId {
    return {
        file: secondPath,
        params: null,
        suite: [],
        title: 'second'
    };
}

function collectedCase(testCase: CaseId): CollectedRunPlan['files'][number]['cases'][number] {
    return {
        implementationDeclaration: null,

        skipReason: null,
        property: null,
        benchmark: null,
        workloadParameters: null,
        annotations,
        controls,
        definitionLocations: [ { kind: 'unknown' as const } ],
        params: testCase.params,
        resourceAttachments: {
            directResources: [],
            resourceGraph: [],
            runtimeGraphs: []
        },
        suitePath: [],
        testFamily: 'integration',
        title: testCase.title
    };
}

function collectedCaseWithWorkload(): CollectedRunPlan['files'][number]['cases'][number] {
    return {
        ...collectedCase(firstCaseId()),
        workId: {
            familyVariant: null,
            case: firstCaseId(),
            runtimes: [],
            workload: {
                name: 'browser',
                params: { channel: 'stable' }
            }
        }
    };
}

function collectedPlan(files: CollectedRunPlan['files']): CollectedRunPlan {
    return {
        implementations: null,

        family: null,
        defined: files.reduce(function sumCases(count, file) {
            return count + file.cases.length;
        }, 0),
        discoveredFiles: [],
        files,
        orphans: [],
        root: { annotations, controls, title: 'worker pool' }
    };
}

function planningInput(
    selectedPlan: CollectedRunPlan,
    workDistribution: WorkDistribution
): WorkUnitPlanningInput {
    return {
        runConstraints: emptyWorkUnitResourceConstraints,
        fileSetForFile() {
            return null;
        },
        order: 'plan',
        seed: { value: 1n },
        selectedPlan,
        scheduling: 'concurrent',
        workDistribution,
        workerLifecycle: 'reuse'
    };
}

export const testNode = suite('Worker pool work identity', [
    test('rejects duplicate catalog identities without counting another discovery', function (scope) {
        const entry = collectedCase(firstCaseId());
        const plan = collectedPlan([ { file: firstPath, cases: [ entry, entry ] } ]);
        scope.assert.throws(function () {
            return collectedCasesByKey(plan);
        }, {
            message: 'Frozen catalog contains duplicate work identities.'
        });
        scope.assert.equal(plan.files[0]?.cases.length, 2);
        return scope.assert.collect();
    }),

    test('worker-pool planning skips empty files and preserves workload ids', function (scope) {
        const workload = {
            name: 'browser',
            params: { channel: 'stable' }
        };
        const work = { familyVariant: null, case: firstCaseId(), runtimes: [], workload };

        scope.assert.deepEqual(
            workUnitsFromCollectedPlan(planningInput(
                collectedPlan([
                    { cases: [], file: 'source/integration-tests/runtime/fixtures/empty.test.ts' },
                    { cases: [ collectedCase(firstCaseId()) ], file: firstPath },
                    { cases: [ collectedCase(secondCaseId()) ], file: secondPath }
                ]),
                { mode: 'file' }
            )),
            [
                {
                    group: null,
                    id: { familyVariant: null, key: firstPath, mode: 'file', runtimes: [], workload: null },
                    ...defaultUnitPolicy,
                    resourceConstraints: emptyWorkUnitResourceConstraints,
                    work: [ { familyVariant: null, case: firstCaseId(), runtimes: [], workload: null } ]
                },
                {
                    group: null,
                    id: { familyVariant: null, key: secondPath, mode: 'file', runtimes: [], workload: null },
                    ...defaultUnitPolicy,
                    resourceConstraints: emptyWorkUnitResourceConstraints,
                    work: [ { familyVariant: null, case: secondCaseId(), runtimes: [], workload: null } ]
                }
            ]
        );
        scope.assert.deepEqual(
            workUnitsFromCollectedPlan(planningInput(
                collectedPlan([
                    { cases: [ collectedCaseWithWorkload() ], file: firstPath }
                ]),
                { mode: 'file' }
            )),
            [ {
                group: null,
                id: { familyVariant: null, key: firstPath, mode: 'file', runtimes: [], workload },
                ...defaultUnitPolicy,
                resourceConstraints: emptyWorkUnitResourceConstraints,
                work: [ work ]
            } ]
        );

        return scope.assert.collect();
    })
]);

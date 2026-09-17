import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type CaseId,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    emptyWorkUnitResourceConstraints,
    type CollectedRunPlan,
    type RunWorkDistribution
} from './run-types.ts';
import { type WorkUnitPlanningInput, workUnitsFromCollectedPlan } from './work-unit-planning.ts';

const firstPath = 'source/integration-tests/run/fixtures/passing.test.ts';
const secondPath = 'source/integration-tests/run/fixtures/delayed-pass.test.ts';
const annotations = { ownership: [], tags: [] };
const controls = { capture: null, timeoutMilliseconds: null };
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
    workDistribution: RunWorkDistribution
): WorkUnitPlanningInput {
    return {
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

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-work-identity.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool planning skips empty files and preserves workload ids',
            body(scope: OverkillScope) {
                const workload = {
                    name: 'browser',
                    params: { channel: 'stable' }
                };
                const work = { case: firstCaseId(), runtimes: [], workload };

                scope.assert.deepEqual(
                    workUnitsFromCollectedPlan(planningInput(
                        collectedPlan([
                            { cases: [], file: 'source/integration-tests/run/fixtures/empty.test.ts' },
                            { cases: [ collectedCase(firstCaseId()) ], file: firstPath },
                            { cases: [ collectedCase(secondCaseId()) ], file: secondPath }
                        ]),
                        { mode: 'file' }
                    )),
                    [
                        {
                            group: null,
                            id: { key: firstPath, mode: 'file', runtimes: [], workload: null },
                            ...defaultUnitPolicy,
                            resourceConstraints: emptyWorkUnitResourceConstraints,
                            work: [ { case: firstCaseId(), runtimes: [], workload: null } ]
                        },
                        {
                            group: null,
                            id: { key: secondPath, mode: 'file', runtimes: [], workload: null },
                            ...defaultUnitPolicy,
                            resourceConstraints: emptyWorkUnitResourceConstraints,
                            work: [ { case: secondCaseId(), runtimes: [], workload: null } ]
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
                        id: { key: firstPath, mode: 'file', runtimes: [], workload },
                        ...defaultUnitPolicy,
                        resourceConstraints: emptyWorkUnitResourceConstraints,
                        work: [ work ]
                    } ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

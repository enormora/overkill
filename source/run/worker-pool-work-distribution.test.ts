import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type CaseId,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { caseIdentityKey } from '../engine/identity.ts';
import type { CollectedRunPlan, WorkUnit } from './run-types.ts';
import { workUnitsFromCollectedPlan } from './work-unit-planning.ts';

const firstPath = 'source/integration-tests/run/fixtures/passing.test.ts';
const secondPath = 'source/integration-tests/run/fixtures/delayed-pass.test.ts';
const annotations = { ownership: [], tags: [] };
const controls = { capture: null, timeoutMilliseconds: null };
const fileSets = new Map([
    [ firstPath, 'fast' ],
    [ secondPath, 'slow' ]
]);

function collectedCase(title: string): CollectedRunPlan['files'][number]['cases'][number] {
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
        suitePath: title === 'first'
            ? [ { definitionLocations: [ { kind: 'unknown' as const } ], title: 'integration' } ]
            : [],
        testFamily: 'integration',
        title
    };
}

function collectedPlan(): CollectedRunPlan {
    return {
        defined: 2,
        discoveredFiles: [],
        files: [
            { cases: [ collectedCase('first') ], file: firstPath },
            { cases: [ collectedCase('second') ], file: secondPath }
        ],
        orphans: [],
        root: { annotations, controls, title: 'worker pool' }
    };
}

function firstCaseId(): CaseId {
    return {
        file: firstPath,
        params: null,
        suite: [ 'integration' ],
        title: 'first'
    };
}

function secondCaseId(): CaseId {
    return {
        file: secondPath,
        params: '["slow"]',
        suite: [],
        title: 'second'
    };
}

function caseWorkUnit(testCase: CaseId): WorkUnit {
    const work = { case: testCase, runtime: null, workload: null };

    return {
        group: null,
        id: { key: caseIdentityKey(testCase), mode: 'case', runtime: null, workload: null },
        work: [ work ]
    };
}

function groupWorkUnit(group: string, cases: readonly [CaseId, ...CaseId[]]): WorkUnit {
    const [ firstCase, ...remainingCases ] = cases;
    const firstWork = { case: firstCase, runtime: null, workload: null };

    return {
        group,
        id: { key: group, mode: 'group', runtime: null, workload: null },
        work: [
            firstWork,
            ...remainingCases.map(function toWork(testCase) {
                return { case: testCase, runtime: null, workload: null };
            })
        ]
    };
}

function fileSetForFile(file: string): string | null {
    return fileSets.get(file) ?? null;
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-work-distribution.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool planning creates case work units',
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    workUnitsFromCollectedPlan(collectedPlan(), { mode: 'case' }),
                    [ caseWorkUnit(firstCaseId()), caseWorkUnit(secondCaseId()) ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool planning creates grouped work units',
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    workUnitsFromCollectedPlan(
                        collectedPlan(),
                        {
                            groups: [
                                { fileSets: [ 'fast' ], name: 'fast' },
                                { fileSets: [ 'slow' ], name: 'slow' }
                            ],
                            mode: 'group',
                            unmatched: 'reject'
                        },
                        fileSetForFile
                    ),
                    [
                        groupWorkUnit('fast', [ firstCaseId() ]),
                        groupWorkUnit('slow', [ secondCaseId() ])
                    ]
                );
                scope.assert.throws(function planUnmatchedGroup() {
                    workUnitsFromCollectedPlan(
                        collectedPlan(),
                        {
                            groups: [ { fileSets: [ 'fast' ], name: 'fast' } ],
                            mode: 'group',
                            unmatched: 'reject'
                        },
                        fileSetForFile
                    );
                }, { message: /no group for file set "slow"/ });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type CaseId,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { caseIdentityKey } from '../engine/identity.ts';
import {
    emptyWorkUnitResourceConstraints,
    type CollectedRunPlan,
    type RunWorkDistribution,
    type RunWorkGroup,
    type WorkUnit
} from './run-types.ts';
import { invalidWorkDistributionConfigMessage } from './work-distribution-config.ts';
import {
    createWorkerPoolPlacementPlan,
    type WorkUnitPlanningInput,
    workUnitsFromCollectedPlan
} from './work-unit-planning.ts';

const firstPath = 'source/integration-tests/run/fixtures/passing.test.ts';
const secondPath = 'source/integration-tests/run/fixtures/delayed-pass.test.ts';
const thirdPath = 'source/integration-tests/run/fixtures/generated-fast.test.ts';
const annotations = { ownership: [], tags: [] };
const controls = { capture: null, timeoutMilliseconds: null };
const fileSets = new Map([
    [ firstPath, 'fast' ],
    [ secondPath, 'slow' ],
    [ thirdPath, 'fast' ]
]);
const defaultUnitPolicy = {
    order: 'plan',
    scheduling: 'concurrent',
    workerLifecycle: 'reuse'
} as const;
const invalidGroupNameMessage = 'Invalid profile work group name "invalid/group". ' +
    'Profile file set names may only contain letters, numbers, dots, underscores, and hyphens.';

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

function collectedPlanWithEmptyFile(): CollectedRunPlan {
    return {
        ...collectedPlan(),
        files: [
            { cases: [], file: 'source/integration-tests/run/fixtures/empty.test.ts' },
            ...collectedPlan().files
        ]
    };
}

function collectedPlanWithRepeatedFastSet(): CollectedRunPlan {
    return {
        ...collectedPlan(),
        defined: 3,
        files: [
            { cases: [ collectedCase('first') ], file: firstPath },
            { cases: [ collectedCase('second') ], file: secondPath },
            { cases: [ collectedCase('third') ], file: thirdPath }
        ]
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

function thirdCaseId(): CaseId {
    return {
        file: thirdPath,
        params: null,
        suite: [],
        title: 'third'
    };
}

function caseWorkUnit(testCase: CaseId): WorkUnit {
    const work = { case: testCase, runtimes: [], workload: null };

    return {
        group: null,
        id: { key: caseIdentityKey(testCase), mode: 'case', runtimes: [], workload: null },
        ...defaultUnitPolicy,
        resourceConstraints: emptyWorkUnitResourceConstraints,
        work: [ work ]
    };
}

function groupedCaseWorkUnit(testCase: CaseId, group: string): WorkUnit {
    return {
        ...caseWorkUnit(testCase),
        group
    };
}

function fileWorkUnit(testCase: CaseId, group: string | null): WorkUnit {
    const { file } = testCase;

    if (file === null) {
        throw new Error('File work unit fixture requires a file-backed case.');
    }

    return {
        group,
        id: { key: file, mode: 'file', runtimes: [], workload: null },
        ...defaultUnitPolicy,
        resourceConstraints: emptyWorkUnitResourceConstraints,
        work: [ { case: testCase, runtimes: [], workload: null } ]
    };
}

function groupWorkUnit(group: string, cases: readonly [CaseId, ...CaseId[]]): WorkUnit {
    const [ firstCase, ...remainingCases ] = cases;
    const firstWork = { case: firstCase, runtimes: [], workload: null };

    return {
        group,
        id: { key: group, mode: 'group', runtimes: [], workload: null },
        ...defaultUnitPolicy,
        resourceConstraints: emptyWorkUnitResourceConstraints,
        work: [
            firstWork,
            ...remainingCases.map(function toWork(testCase) {
                return { case: testCase, runtimes: [], workload: null };
            })
        ]
    };
}

function fileSetForFile(file: string): string | null {
    return fileSets.get(file) ?? null;
}

function workGroup(name: string, groupFileSets: readonly [string, ...string[]]): RunWorkGroup {
    return {
        fileSets: groupFileSets,
        granularity: 'group',
        name,
        order: 'profile-default',
        scheduling: 'profile-default',
        workerLifecycle: 'profile-default'
    };
}

function workGroupWithGranularity(
    name: string,
    groupFileSets: readonly [string, ...string[]],
    granularity: RunWorkGroup['granularity']
): RunWorkGroup {
    return {
        ...workGroup(name, groupFileSets),
        granularity
    };
}

function workGroupWithOrder(
    name: string,
    groupFileSets: readonly [string, ...string[]],
    granularity: RunWorkGroup['granularity'],
    order: RunWorkGroup['order']
): RunWorkGroup {
    return {
        ...workGroupWithGranularity(name, groupFileSets, granularity),
        order
    };
}

function workGroupWithPolicyOverrides(
    name: string,
    groupFileSets: readonly [string, ...string[]]
): RunWorkGroup {
    return {
        ...workGroupWithGranularity(name, groupFileSets, 'file'),
        scheduling: 'serial',
        workerLifecycle: 'fresh-worker-per-unit'
    };
}

function planningInput(
    selectedPlan: CollectedRunPlan,
    workDistribution: RunWorkDistribution,
    fileSetLookup: (file: string) => string | null
): WorkUnitPlanningInput {
    return {
        fileSetForFile: fileSetLookup,
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
    title: 'source/run/worker-pool-work-distribution.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool planning creates case work units',
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    workUnitsFromCollectedPlan(planningInput(collectedPlan(), { mode: 'case' }, fileSetForFile)),
                    [ caseWorkUnit(firstCaseId()), caseWorkUnit(secondCaseId()) ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool planning applies group overrides with unmatched file fallback',
            body(scope: OverkillScope) {
                const fastFileUnit = {
                    ...fileWorkUnit(firstCaseId(), 'fast-files'),
                    scheduling: 'serial',
                    workerLifecycle: 'fresh-worker-per-unit'
                } as const;

                scope.assert.deepEqual(
                    workUnitsFromCollectedPlan(planningInput(
                        collectedPlanWithEmptyFile(),
                        {
                            groups: [
                                workGroup('empty-group', [ 'empty' ]),
                                workGroupWithPolicyOverrides('fast-files', [ 'fast' ])
                            ],
                            mode: 'group',
                            unmatched: 'file'
                        },
                        fileSetForFile
                    )),
                    [
                        fastFileUnit,
                        fileWorkUnit(secondCaseId(), null)
                    ]
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
                    workUnitsFromCollectedPlan(planningInput(
                        collectedPlan(),
                        {
                            groups: [
                                workGroup('fast', [ 'fast' ]),
                                workGroup('slow', [ 'slow' ])
                            ],
                            mode: 'group',
                            unmatched: 'reject'
                        },
                        fileSetForFile
                    )),
                    [
                        groupWorkUnit('fast', [ firstCaseId() ]),
                        groupWorkUnit('slow', [ secondCaseId() ])
                    ]
                );
                scope.assert.throws(function planUnmatchedGroup() {
                    workUnitsFromCollectedPlan(planningInput(
                        collectedPlan(),
                        {
                            groups: [ workGroup('fast', [ 'fast' ]) ],
                            mode: 'group',
                            unmatched: 'reject'
                        },
                        fileSetForFile
                    ));
                }, { message: /no group for file set "slow"/ });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool planning applies named group granularity',
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    workUnitsFromCollectedPlan(planningInput(
                        collectedPlan(),
                        {
                            groups: [
                                workGroupWithGranularity('fast-files', [ 'fast' ], 'file'),
                                workGroupWithGranularity('slow-cases', [ 'slow' ], 'case')
                            ],
                            mode: 'group',
                            unmatched: 'reject'
                        },
                        fileSetForFile
                    )),
                    [
                        fileWorkUnit(firstCaseId(), 'fast-files'),
                        groupedCaseWorkUnit(secondCaseId(), 'slow-cases')
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool planning falls back to file units for unmatched sets',
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    workUnitsFromCollectedPlan(planningInput(
                        collectedPlan(),
                        {
                            groups: [ workGroup('fast', [ 'fast' ]) ],
                            mode: 'group',
                            unmatched: 'file'
                        },
                        fileSetForFile
                    )),
                    [
                        groupWorkUnit('fast', [ firstCaseId() ]),
                        fileWorkUnit(secondCaseId(), null)
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool planning applies group-local order inside profile order slots',
            body(scope: OverkillScope) {
                const units = workUnitsFromCollectedPlan(planningInput(
                    collectedPlanWithRepeatedFastSet(),
                    {
                        groups: [
                            workGroupWithOrder('fast-cases', [ 'fast' ], 'case', 'seeded'),
                            workGroupWithGranularity('slow-cases', [ 'slow' ], 'case')
                        ],
                        mode: 'group',
                        unmatched: 'reject'
                    },
                    fileSetForFile
                ));

                scope.assert.deepEqual(
                    units.map(function toUnitKey(unit) {
                        return unit.id.key;
                    }),
                    [
                        caseIdentityKey(thirdCaseId()),
                        caseIdentityKey(secondCaseId()),
                        caseIdentityKey(firstCaseId())
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool planning rejects grouped work without file-set ownership',
            body(scope: OverkillScope) {
                scope.assert.throws(function planWithoutFileSetLookup() {
                    workUnitsFromCollectedPlan(planningInput(
                        collectedPlan(),
                        {
                            groups: [ workGroup('fast', [ 'fast' ]) ],
                            mode: 'group',
                            unmatched: 'reject'
                        },
                        function noFileSet() {
                            return null;
                        }
                    ));
                }, { message: /requires a file set/ });
                scope.assert.deepEqual(
                    workUnitsFromCollectedPlan(planningInput(
                        collectedPlanWithEmptyFile(),
                        {
                            groups: [
                                workGroup('fast', [ 'fast' ]),
                                workGroup('slow', [ 'slow' ])
                            ],
                            mode: 'group',
                            unmatched: 'reject'
                        },
                        fileSetForFile
                    )),
                    [
                        groupWorkUnit('fast', [ firstCaseId() ]),
                        groupWorkUnit('slow', [ secondCaseId() ])
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool placement rejects invalid available parallelism',
            body(scope: OverkillScope) {
                for (const availableParallelism of [ Number.NaN, 0 ]) {
                    scope.assert.throws(function rejectInvalidParallelism() {
                        createWorkerPoolPlacementPlan({
                            assignmentPolicy: 'case-count-balanced',
                            availableParallelism,
                            fileSetForFile,
                            order: 'plan',
                            seed: { value: 1n },
                            selectedPlan: collectedPlan(),
                            scheduling: 'concurrent',
                            workDistribution: { mode: 'file' },
                            workerLifecycle: 'reuse'
                        });
                    }, { message: 'Available parallelism must be a positive safe integer.' });
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'worker-pool distribution config rejects invalid group names',
            body(scope: OverkillScope) {
                scope.assert.equal(
                    invalidWorkDistributionConfigMessage(
                        {
                            assignmentPolicy: 'case-count-balanced',
                            hostProcess: { kind: 'direct' },
                            processModel: 'worker-pool',
                            scheduling: 'concurrent',
                            workDistribution: {
                                groups: [ workGroup('invalid/group', [ 'fast' ]) ],
                                mode: 'group',
                                unmatched: 'reject'
                            },
                            workerLifecycle: 'reuse'
                        },
                        {
                            sets: {
                                fast: {
                                    exclude: [],
                                    include: [ firstPath ]
                                }
                            }
                        }
                    ),
                    invalidGroupNameMessage
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

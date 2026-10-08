import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestNode,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { defineResource } from '../packages/resources/resources.entry-point.ts';
import {
    assertResourceDependencyScopes,
    resourceDependencyScopeAllowed
} from '../resources/resource-graph.ts';
import type { WorkerLifecycle } from '../config/types.ts';
import { collectedRunCaseEntries } from './collected-run-plan.ts';
import {
    collectedPlanCompatibilityConflicts,
    createResourceOwnershipPlan,
    executionPlanCompatibilityConflicts
} from './execution-plan-resolution.ts';
import { RunExecutionPlanError, type RunExecutionPlanConflict } from './run-errors.ts';
import {
    emptyWorkUnitResourceConstraints,
    type CollectedRunPlan,
    type PlacementLane,
    type WorkUnit
} from './run-types.ts';

const annotations = { ownership: [], tags: [] };
const controls = { capture: null, duplicateExecution: null, timeoutMilliseconds: null };

function collectedPlan(): CollectedRunPlan {
    return {
        defined: 2,
        discoveredFiles: [],
        files: [ {
            cases: [ 'first', 'second' ].map(function collectedCase(title) {
                return {
                    annotations,
                    controls,
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    params: null,
                    resourceAttachments: { directResources: [], resourceGraph: [], runtimeGraphs: [] },
                    suitePath: [],
                    testFamily: 'integration' as const,
                    title
                };
            }),
            file: 'test.ts'
        } ],
        orphans: [],
        root: { annotations, controls, title: 'compatibility' }
    };
}

function resourcePlan(scope: 'per-file' | 'per-run'): CollectedRunPlan {
    const plan = collectedPlan();

    return {
        ...plan,
        files: plan.files.map(function attachResources(file) {
            return {
                ...file,
                cases: file.cases.map(function attachResource(testCase) {
                    return {
                        ...testCase,
                        resourceAttachments: {
                            directResources: [ { key: 'shared', resourceName: 'shared' } ],
                            resourceGraph: [ {
                                dependencies: [],
                                handleTransport: 'projected' as const,
                                name: 'shared',
                                requirements: [],
                                scenarios: [],
                                scope
                            } ],
                            runtimeGraphs: []
                        }
                    };
                })
            };
        })
    };
}

function identityConflictPlan(): CollectedRunPlan {
    const plan = collectedPlan();

    return {
        ...plan,
        files: plan.files.map(function attachDefinitions(file) {
            return {
                ...file,
                cases: file.cases.map(function attachDefinition(testCase, index) {
                    return {
                        ...testCase,
                        resourceAttachments: {
                            directResources: [],
                            resourceGraph: [
                                {
                                    dependencies: index === 0 ? [ 'missing', 'run-dependency' ] : [],
                                    handleTransport: index === 0 ? 'local' as const : 'projected' as const,
                                    name: 'shared',
                                    requirements: [],
                                    scenarios: [],
                                    scope: index === 0 ? 'per-run' : 'per-file'
                                },
                                {
                                    dependencies: [ 'run-dependency' ],
                                    handleTransport: 'projected' as const,
                                    name: 'invalid',
                                    requirements: [],
                                    scenarios: [],
                                    scope: 'invalid'
                                },
                                {
                                    dependencies: [],
                                    handleTransport: 'projected' as const,
                                    name: 'run-dependency',
                                    requirements: [],
                                    scenarios: [],
                                    scope: 'per-run'
                                }
                            ],
                            runtimeGraphs: [ {
                                dimensions: {},
                                name: 'runtime',
                                requirements: index === 0
                                    ? []
                                    : [ { kind: 'exclusive-resource' as const, name: 'database' } ],
                                resources: [],
                                scenarioBindings: []
                            } ]
                        },
                        workId: {
                            case: { file: file.file, params: null, suite: [], title: testCase.title },
                            runtimes: [ { dimensions: {}, name: 'runtime', scenarios: {}, variantId: null } ],
                            workload: null
                        }
                    };
                })
            };
        })
    };
}

function withoutFirstRuntime(plan: CollectedRunPlan): CollectedRunPlan {
    const file = plan.files[0];

    if (file === undefined) {
        throw new Error('Runtime fixture requires one file.');
    }

    return {
        ...plan,
        files: [ {
            ...file,
            cases: file.cases.map(function removeFirstRuntime(testCase, index) {
                return index === 0
                    ? {
                        ...testCase,
                        resourceAttachments: { ...testCase.resourceAttachments, runtimeGraphs: [] }
                    }
                    : testCase;
            })
        } ]
    };
}

function workUnit(
    key: string,
    work: WorkUnit['work'],
    workerLifecycle: WorkerLifecycle,
    singleWorkerKeys: readonly string[]
): WorkUnit {
    return {
        group: null,
        id: { key, mode: 'case', runtimes: [], workload: null },
        order: 'plan',
        resourceConstraints: { ...emptyWorkUnitResourceConstraints, singleWorkerKeys },
        scheduling: 'concurrent',
        work,
        workerLifecycle
    };
}

function localLane(): PlacementLane {
    return {
        executor: { capabilities: [], capacity: 1, id: 'lane', kind: 'local-worker' },
        id: 'lane'
    };
}

function assertDependencyScopes(scope: OverkillScope): void {
    const scopes = [ 'per-run', 'per-file', 'per-suite', 'shared-per-worker', 'per-case' ] as const;
    const allowed = scopes.map(function resourceRow(resourceScope) {
        return scopes.map(function dependencyCell(dependencyScope) {
            return resourceDependencyScopeAllowed({ scope: resourceScope }, { scope: dependencyScope });
        });
    });

    scope.assert.deepEqual(allowed, [
        [ true, false, false, false, false ],
        [ true, true, false, false, false ],
        [ true, true, true, false, false ],
        [ true, false, false, true, false ],
        [ true, true, true, true, true ]
    ]);
}

function assertDependencyGraphs(scope: OverkillScope): void {
    const dependency = defineResource({
        acquire() {
            return 'dependency';
        },
        dispose: null,
        name: 'dependency',
        requirements: [],
        scope: 'per-case'
    });
    const resource = defineResource({
        acquire() {
            return 'resource';
        },
        dependencies: { dependency },
        dispose: null,
        name: 'resource',
        requirements: [],
        scope: 'per-case'
    });
    const invalidResource = defineResource({
        acquire() {
            return 'invalid-resource';
        },
        dependencies: { dependency },
        deserializeHandle: String,
        dispose: null,
        name: 'invalid-resource',
        requirements: [],
        scope: 'per-run',
        serializeHandle: String
    });

    assertResourceDependencyScopes({ resource });
    scope.assert.throws(function rejectNarrowerDependency() {
        assertResourceDependencyScopes({ invalidResource });
    }, {
        message: 'Resource "invalid-resource" uses per-run scope and cannot depend on ' +
            'resource "dependency" with per-case scope.'
    });
}

function assertIdentityConflicts(scope: OverkillScope): void {
    const plan = identityConflictPlan();
    const conflictKinds = collectedPlanCompatibilityConflicts(plan).map(function conflictKind(conflict) {
        return conflict.kind;
    });
    const missingRuntimeKinds = collectedPlanCompatibilityConflicts(withoutFirstRuntime(plan)).map(
        function conflictKind(conflict) {
            return conflict.kind;
        }
    );

    scope.assert.deepEqual(conflictKinds, [ 'resource-definition', 'runtime-definition' ]);
    scope.assert.deepEqual(missingRuntimeKinds, [ 'resource-definition' ]);
}

function assertExecutionConflicts(scope: OverkillScope): void {
    const plan = collectedPlan();
    const [ first, second ] = collectedRunCaseEntries(plan);
    scope.require.object(first);
    scope.require.object(second);
    const units = [
        workUnit('reuse', [ first.workId ], 'reuse', [ 'shared' ]),
        workUnit('fresh', [ second.workId ], 'fresh-worker-per-unit', [ 'shared' ])
    ];
    const conflicts = executionPlanCompatibilityConflicts({
        requiredLifecycleLanes: 2,
        selectedPlan: plan,
        units,
        workerCount: { hostMaximum: 1, profileMaximum: null, requested: null, resolved: 1 }
    });

    scope.assert.deepEqual(
        conflicts.map(function conflictKind(conflict) {
            return conflict.kind;
        }),
        [ 'worker-capacity', 'worker-lifecycle' ]
    );
    scope.assert.throws(function rejectMissingLifecycle() {
        executionPlanCompatibilityConflicts({
            requiredLifecycleLanes: 1,
            selectedPlan: plan,
            units: [],
            workerCount: { hostMaximum: 0, profileMaximum: null, requested: null, resolved: 0 }
        });
    }, { message: 'Worker capacity conflict requires lifecycles.' });
}

function ownershipPlacementKinds(
    plan: CollectedRunPlan,
    units: readonly WorkUnit[]
): readonly string[] {
    return createResourceOwnershipPlan({ lanes: [ localLane() ], selectedPlan: plan, units })
        .owners
        .map(function placementKind(owner) {
            return owner.placement.kind;
        });
}

function requiredPlanWork(
    scope: OverkillScope,
    plan: CollectedRunPlan
): readonly [WorkUnit['work'][number], WorkUnit['work'][number]] {
    const [ first, second ] = collectedRunCaseEntries(plan);

    scope.require.object(first);
    scope.require.object(second);

    return [ first.workId, second.workId ];
}

function assertOwnershipPlacements(scope: OverkillScope): void {
    const runPlan = resourcePlan('per-run');
    const [ firstRun, secondRun ] = requiredPlanWork(scope, runPlan);
    const filePlan = resourcePlan('per-file');
    const [ firstFile, secondFile ] = requiredPlanWork(scope, filePlan);

    scope.assert.deepEqual(
        ownershipPlacementKinds(runPlan, [
            workUnit('run', [ firstRun, secondRun ], 'reuse', [])
        ]),
        [ 'executor-lane' ]
    );
    scope.assert.deepEqual(
        ownershipPlacementKinds(filePlan, [
            workUnit('file', [ firstFile ], 'reuse', [])
        ]),
        [ 'work-unit' ]
    );
    scope.assert.deepEqual(
        ownershipPlacementKinds(filePlan, [
            workUnit('first', [ firstFile ], 'fresh-worker-per-unit', []),
            workUnit('second', [ secondFile ], 'fresh-worker-per-unit', [])
        ]),
        [ 'infrastructure-worker' ]
    );
    scope.assert.deepEqual(
        ownershipPlacementKinds(filePlan, [
            workUnit('first', [ firstFile ], 'reuse', []),
            workUnit('second', [ secondFile ], 'reuse', [])
        ]),
        [ 'executor-lane' ]
    );
}

const work = {
    case: { file: 'test.ts', params: null, suite: [], title: 'test' },
    runtimes: [],
    workload: null
};
const unit = { key: 'unit', mode: 'case' as const, runtimes: [], workload: null };
const describedConflicts: readonly RunExecutionPlanConflict[] = [
    {
        boundaryKey: 'resource@per-run',
        kind: 'resource-projection-required',
        resource: { name: 'resource', scope: 'per-run' },
        work: [ work ]
    },
    {
        dependency: { name: 'case', scope: 'per-case' },
        kind: 'resource-dependency-scope',
        resource: { name: 'run', scope: 'per-run' },
        work: [ work ]
    },
    {
        definitions: [ { name: 'resource', scope: 'per-run' } ],
        kind: 'resource-definition',
        name: 'resource',
        work: [ work ]
    },
    {
        constraint: 'shared',
        kind: 'worker-lifecycle',
        lifecycles: [ 'reuse', 'fresh-worker-per-unit' ],
        units: [ unit ]
    },
    { available: 1, kind: 'worker-capacity', lifecycles: [ 'reuse' ], required: 2 },
    { file: 'test.ts', fileSet: null, kind: 'work-distribution', reason: 'missing-file-set' },
    { file: 'other.test.ts', fileSet: 'other', kind: 'work-distribution', reason: 'unmatched-file-set' },
    {
        kind: 'runtime-definition',
        runtime: { dimensions: {}, name: 'runtime', scenarios: {}, variantId: null },
        work: [ work ]
    },
    {
        kind: 'process-model',
        processModel: 'in-process',
        reason: 'test-family',
        testFamily: 'integration',
        work: [ work ]
    }
];

function assertErrorDescriptions(scope: OverkillScope): void {
    const error = new RunExecutionPlanError(describedConflicts, undefined);
    const unknownError = new RunExecutionPlanError([
        { kind: 'unknown' } as unknown as RunExecutionPlanConflict
    ], undefined);
    const descriptions = [
        'requires handle projection',
        'cannot depend on',
        'incompatible definitions',
        'incompatible worker lifecycles',
        'requires 2 lifecycle lanes',
        'requires a file set',
        'has no group for file set',
        'Runtime identity',
        'Process model'
    ];

    scope.assert.deepEqual(
        descriptions.map(function messageIncluded(description) {
            return error.message.includes(description);
        }),
        descriptions.map(function () {
            return true;
        })
    );
    scope.assert.equal(
        unknownError.message,
        'Execution plan is incompatible: Execution plan has an unknown incompatibility.'
    );
    scope.assert.throws(function rejectEmptyConflicts() {
        return new RunExecutionPlanError([], undefined);
    }, { message: 'Execution plan conflicts must not be empty.' });
}

function compatibilityTest(title: string, assertion: (scope: OverkillScope) => void): TestNode {
    return createOverkillTestCase({
        annotations: {},
        controls: {},
        definitionLocations: [ { kind: 'unknown' as const } ],
        title,
        body(scope: OverkillScope) {
            assertion(scope);

            return scope.assert.collect();
        }
    });
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/execution-plan-compatibility.test.ts',
    children: [
        compatibilityTest('resource dependency scopes follow ownership nesting', function assertScopes(scope) {
            assertDependencyScopes(scope);
            assertDependencyGraphs(scope);
        }),
        compatibilityTest(
            'collected compatibility reports resource and runtime identity conflicts',
            assertIdentityConflicts
        ),
        compatibilityTest(
            'execution compatibility reports lifecycle and worker capacity conflicts',
            assertExecutionConflicts
        ),
        compatibilityTest('resource ownership selects lane and unit placements', assertOwnershipPlacements),
        compatibilityTest('execution plan errors describe every incompatibility', assertErrorDescriptions)
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

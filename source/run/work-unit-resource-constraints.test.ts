import { type TestNode, suite, test } from '@overkill-dev/test';

import type { TestBodyExecutionRequirementSummary } from '../packages/engine/engine.entry-point.ts';
import type { WorkId } from '../engine/identity.ts';
import { emptyWorkUnitResourceConstraints, type CollectedRunCase, type CollectedRunPlan } from './run-types.ts';
import { workResourceConstraints } from './work-unit-resource-constraints.ts';

const annotations = { ownership: [], tags: [] };
const controls = { capture: null, duplicateExecution: null, timeoutMilliseconds: null };
const filePath = 'source/api.test.ts';

function collectedCaseWithControls(
    title: string,
    resources: CollectedRunCase['resourceAttachments']['resourceGraph'],
    caseControls: CollectedRunCase['controls']
): CollectedRunCase {
    return {
        implementationDeclaration: null,

        skipReason: null,
        property: null,
        benchmark: null,
        workloadParameters: null,
        annotations,
        controls: caseControls,
        definitionLocations: [ { kind: 'unknown' as const } ],
        params: null,
        resourceAttachments: {
            directResources: [],
            resourceGraph: resources,
            runtimeGraphs: []
        },
        suitePath: [ { definitionLocations: [ { kind: 'unknown' as const } ], title: 'api' } ],
        testFamily: 'integration',
        title
    };
}

function collectedCase(
    title: string,
    resources: CollectedRunCase['resourceAttachments']['resourceGraph']
): CollectedRunCase {
    return collectedCaseWithControls(title, resources, controls);
}

function resource(
    name: string,
    scope: string,
    requirements: readonly TestBodyExecutionRequirementSummary[]
): CollectedRunCase['resourceAttachments']['resourceGraph'][number] {
    return {
        workload: 'independent' as const,
        dependencies: [],
        handleTransport: 'local',
        name,
        requirements,
        scenarios: [],
        scope
    };
}

function collectedPlan(cases: readonly CollectedRunCase[]): CollectedRunPlan {
    return {
        implementations: null,

        family: null,
        defined: cases.length,
        discoveredFiles: [],
        files: [ { cases, file: filePath } ],
        orphans: [],
        root: { annotations, controls, title: 'resource constraints' }
    };
}

function workId(title: string): WorkId {
    return {
        familyVariant: null,
        case: {
            file: filePath,
            params: null,
            suite: [ 'api' ],
            title
        },
        runtimes: [],
        workload: null
    };
}

export const testNode: TestNode = suite('Work unit resource constraints', [
    test(
        'combines runtime variants and workload-dependent resources',
        function (scope) {
            const testCase: CollectedRunCase = {
                ...collectedCase('runtime requirements', [
                    { ...resource('consumer', 'per-suite', []), dependencies: [ 'supplier' ] },
                    { ...resource('supplier', 'per-case', []), workload: 'required' }
                ]),
                resourceAttachments: {
                    directResources: [],
                    resourceGraph: [
                        { ...resource('consumer', 'per-suite', []), dependencies: [ 'supplier' ] },
                        { ...resource('supplier', 'per-case', []), workload: 'required' }
                    ],
                    runtimeGraphs: [
                        {
                            kind: 'runtime',
                            name: 'plain',
                            dimensions: {},
                            resources: [],
                            scenarioBindings: [],
                            requirements: [ { kind: 'serial' }, { kind: 'affinity-key', key: 'tenant' }, {
                                kind: 'capacity-weight',
                                weight: 2
                            } ]
                        },
                        {
                            kind: 'runtime-matrix',
                            name: 'matrix',
                            resources: [],
                            variants: [ {
                                id: 'variant',
                                runtime: {
                                    name: 'inner',
                                    dimensions: {},
                                    resources: [],
                                    scenarioBindings: [],
                                    requirements: [ { kind: 'fault-domain', key: 'backend' }, {
                                        kind: 'capacity-weight',
                                        weight: 3
                                    } ]
                                }
                            } ]
                        }
                    ]
                }
            };
            scope.assert.deepEqual(
                workResourceConstraints([ workId('runtime requirements') ], collectedPlan([ testCase ])),
                {
                    affinityKeys: [ 'tenant' ],
                    capacityWeight: 6,
                    duplicateExecution: [],
                    faultDomains: [ 'backend' ],
                    serialKeys: [ 'serial:runtime:plain' ],
                    singleWorkerKeys: [ 'resource:suite:source/api.test.ts:["api"]:consumer:workload:null' ]
                }
            );
            return scope.assert.collect();
        }
    ),

    test('lowers resource scopes and requirements', function (scope) {
        const firstCase = collectedCase('first', [
            resource('runScoped', 'per-run', []),
            resource('caseScoped', 'per-case', []),
            resource('fileScoped', 'per-file', []),
            resource('suiteScoped', 'per-suite', []),
            resource('workerScoped', 'shared-per-worker', []),
            resource('serialBound', 'per-case', [ { kind: 'serial' } ]),
            resource('exclusiveBound', 'per-case', [ { kind: 'exclusive-resource', name: 'database' } ]),
            resource('singleWorkerBound', 'per-case', [ { kind: 'single-worker' } ]),
            resource('affinityBound', 'per-case', [ { kind: 'affinity-key', key: 'tenant-a' } ]),
            resource('faultBound', 'per-case', [ { kind: 'fault-domain', key: 'postgres-primary' } ]),
            resource('weighted', 'per-case', [ { kind: 'capacity-weight', weight: 5 } ]),
            resource('duplicateSafe', 'per-case', [
                { kind: 'duplicate-execution', safety: 'disposable-isolated' }
            ]),
            resource('ignoredRequirements', 'unknown', [
                { kind: 'exclusive-resource' },
                { kind: 'affinity-key' },
                { kind: 'fault-domain' },
                { kind: 'capacity-weight', weight: -3 },
                { kind: 'capacity-weight', weight: Number.NaN },
                { kind: 'unknown' },
                { kind: 42 }
            ])
        ]);
        const secondCase = collectedCase('second', [
            resource('duplicateExclusiveBound', 'per-case', [
                { kind: 'exclusive-resource', name: 'database' }
            ]),
            resource('anotherAffinityBound', 'per-case', [ { kind: 'affinity-key', key: 'tenant-b' } ]),
            resource('anotherFaultBound', 'per-case', [ { kind: 'fault-domain', key: 'redis-primary' } ]),
            resource('anotherWeighted', 'per-case', [ { kind: 'capacity-weight', weight: 2 } ])
        ]);

        const constraints = workResourceConstraints(
            [ workId('first'), workId('second') ],
            collectedPlan([ firstCase, secondCase ])
        );

        scope.assert.deepEqual(
            constraints,
            {
                affinityKeys: [ 'resource:worker:workerScoped', 'tenant-a', 'tenant-b' ],
                capacityWeight: 8,
                duplicateExecution: [ 'disposable-isolated' ],
                faultDomains: [ 'postgres-primary', 'redis-primary' ],
                serialKeys: [ 'serial:serialBound', 'database' ],
                singleWorkerKeys: [
                    `resource:file:${filePath}:fileScoped`,
                    `resource:suite:${filePath}:["api"]:suiteScoped`,
                    'single-worker:singleWorkerBound'
                ]
            }
        );

        return scope.assert.collect();
    }),
    test(
        'lowers duplicate execution controls and forbidden override',
        function (scope) {
            const idempotentCase = collectedCaseWithControls(
                'idempotent',
                [],
                { ...controls, duplicateExecution: 'idempotent' }
            );
            const forbiddenCase = collectedCaseWithControls(
                'forbidden',
                [
                    resource('duplicateSafe', 'per-case', [
                        { kind: 'duplicate-execution', safety: 'idempotent' }
                    ])
                ],
                { ...controls, duplicateExecution: 'forbidden' }
            );

            scope.assert.deepEqual(
                workResourceConstraints([ workId('idempotent') ], collectedPlan([ idempotentCase ]))
                    .duplicateExecution,
                [ 'idempotent' ]
            );
            scope.assert.deepEqual(
                workResourceConstraints([ workId('forbidden') ], collectedPlan([ forbiddenCase ]))
                    .duplicateExecution,
                []
            );

            return scope.assert.collect();
        }
    ),
    test('keeps unmatched work empty', function (scope) {
        scope.assert.equal(
            workResourceConstraints([
                {
                    familyVariant: null,
                    case: {
                        file: null,
                        params: null,
                        suite: [ 'api' ],
                        title: 'first'
                    },
                    runtimes: [],
                    workload: null
                }
            ], collectedPlan([ collectedCase('first', []) ])),
            emptyWorkUnitResourceConstraints
        );

        return scope.assert.collect();
    })
]);

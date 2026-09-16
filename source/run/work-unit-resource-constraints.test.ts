import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestBodyExecutionRequirementSummary,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    emptyWorkUnitResourceConstraints,
    type CollectedRunCase,
    type CollectedRunPlan,
    type WorkId
} from './run-types.ts';
import { workResourceConstraints } from './work-unit-resource-constraints.ts';

const annotations = { ownership: [], tags: [] };
const controls = { capture: null, timeoutMilliseconds: null };
const filePath = 'source/api.test.ts';

function collectedCase(
    title: string,
    resources: CollectedRunCase['resourceAttachments']['resourceGraph']
): CollectedRunCase {
    return {
        annotations,
        controls,
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

function resource(
    name: string,
    scope: string,
    requirements: readonly TestBodyExecutionRequirementSummary[]
): CollectedRunCase['resourceAttachments']['resourceGraph'][number] {
    return {
        dependencies: [],
        name,
        requirements,
        scope
    };
}

function collectedPlan(cases: readonly CollectedRunCase[]): CollectedRunPlan {
    return {
        defined: cases.length,
        discoveredFiles: [],
        files: [ { cases, file: filePath } ],
        orphans: [],
        root: { annotations, controls, title: 'resource constraints' }
    };
}

function workId(title: string): WorkId {
    return {
        case: {
            file: filePath,
            params: null,
            suite: [ 'api' ],
            title
        },
        runtime: null,
        workload: null
    };
}

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/work-unit-resource-constraints.test.ts',
    children: [
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'workResourceConstraints() lowers resource scopes and requirements',
            body(scope: OverkillScope) {
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
                        affinityKeys: [ 'tenant-a', 'tenant-b' ],
                        capacityWeight: 8,
                        faultDomains: [ 'postgres-primary', 'redis-primary' ],
                        serialKeys: [ 'serial:serialBound', 'database' ],
                        singleWorkerKeys: [
                            `resource:file:${filePath}:fileScoped`,
                            `resource:suite:${filePath}:["api"]:suiteScoped`,
                            'resource:worker:workerScoped',
                            'single-worker:singleWorkerBound'
                        ]
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'workResourceConstraints() keeps unmatched work empty',
            body(scope: OverkillScope) {
                scope.assert.equal(
                    workResourceConstraints([
                        {
                            case: {
                                file: null,
                                params: null,
                                suite: [ 'api' ],
                                title: 'first'
                            },
                            runtime: null,
                            workload: null
                        }
                    ], collectedPlan([ collectedCase('first', []) ])),
                    emptyWorkUnitResourceConstraints
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

import { suite, test, type TestScope } from '@overkill-dev/test';

import { createCaseId } from '../engine/identity.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import { defineResource } from '../resources/resources.ts';
import { bindResourceScenarios } from '../resources/resource-scenario-binding.ts';

import { caseResourceBoundaryKeys, resourceLifecycleBoundaryUseCounts } from './resource-lifecycle-boundaries.ts';
import {
    resourceAcquisitionCacheIdentity,
    resourceDescriptorCacheIdentityNode,
    resourceHandleCacheIdentity,
    type ResourceCacheIdentityNode
} from './resource-lifecycle-cache-identity.ts';

type ScenarioCaseOptions = {
    readonly dependent?: boolean;
    readonly timing?: 'acquire' | 'request-routed';
};

function scenarioCase(title: string, scope: string, value: string, options: ScenarioCaseOptions = {}): TestPlanCase {
    const id = createCaseId('scenario.test.ts', [ 'suite' ], title, null);
    const timing = options.timing ?? 'acquire';
    const resourceGraph: TestPlanCase['resourceAttachments']['resourceGraph'] = [
        {
            workload: 'independent' as const,
            dependencies: [],
            handleTransport: 'local' as const,
            name: 'database',
            requirements: [],
            scenarios: [ {
                default: 'primary',
                name: 'database',
                timing,
                values: [ 'primary', 'replica' ]
            } ],
            scope
        },
        ...options.dependent === true
            ? [ {
                workload: 'independent' as const,
                dependencies: [ 'database' ],
                handleTransport: 'local' as const,
                name: 'server',
                requirements: [],
                scenarios: [],
                scope
            } ]
            : []
    ];
    const rootResourceName = options.dependent === true ? 'server' : 'database';

    return {
        bodyOrigin: null,
        workloadParameters: null,
        annotations: { ownership: [], tags: [] },
        controls: { capture: null, duplicateExecution: null, timeoutMilliseconds: null },
        definitionLocations: [ { kind: 'unknown' } ],
        execution: { kind: 'skip', reason: 'planning only' },
        id,
        resourceAttachments: {
            directResources: [],
            resourceGraph,
            runtimeGraphs: [ {
                dimensions: {},
                kind: 'runtime',
                name: 'api',
                requirements: [],
                resources: [ { key: rootResourceName, resourceName: rootResourceName } ],
                scenarioBindings: [ {
                    default: 'primary',
                    name: 'database',
                    owner: { path: [ 'database' ], resourceName: 'database' },
                    timing,
                    value,
                    values: [ 'primary', 'replica' ]
                } ]
            } ]
        },
        suitePath: [ { definitionLocations: [ { kind: 'unknown' } ], title: 'suite' } ],
        testFamily: 'integration',
        workId: {
            familyVariant: null,
            case: id,
            runtimes: [ { dimensions: {}, name: 'api', scenarios: { database: value }, variantId: null } ],
            workload: null
        }
    };
}

function countsForResource(testCases: readonly TestPlanCase[], resourceName: string): readonly number[] {
    return resourceLifecycleBoundaryUseCounts(testCases)
        .filter(function resourceMatches(count) {
            return count.boundaryKey.includes(`${resourceName}@`);
        })
        .map(function boundaryCount(count) {
            return count.count;
        })
        .toSorted(function compareCounts(left, right) {
            return left - right;
        });
}

function reorderedCacheNode(node: ResourceCacheIdentityNode): ResourceCacheIdentityNode {
    return { ...node, dependencies: node.dependencies.toReversed(), scenarios: node.scenarios.toReversed() };
}

export const testNode = suite('Resource lifecycle boundaries', [
    test('ignores unknown resource summaries and deduplicates shared dependencies', function (scope: TestScope) {
        const source = scenarioCase('case', 'per-run', 'primary');
        const original = source.resourceAttachments.resourceGraph[0];
        scope.require.defined(original);
        const resource = { ...original, dependencies: [ 'missing' ] };
        const attachments = {
            ...source.resourceAttachments,
            resourceGraph: [ resource ],
            directResources: [ { key: 'one', resourceName: 'database' }, { key: 'two', resourceName: 'database' }, {
                key: 'absent',
                resourceName: 'absent'
            } ]
        };
        const testCase = { ...source, resourceAttachments: { ...attachments, runtimeGraphs: [] } };
        scope.assert.equal(caseResourceBoundaryKeys(testCase, new Set([ 'per-run' ])).length, 1);
        scope.assert.deepEqual(
            caseResourceBoundaryKeys(scenarioCase('case', 'unsupported', 'primary'), new Set([ 'per-run' ])),
            []
        );

        return scope.assert.collect();
    }),
    test('selects the default runtime matrix variant and rejects empty matrices', function (scope: TestScope) {
        const source = scenarioCase('case', 'per-run', 'primary');
        const runtime = source.resourceAttachments.runtimeGraphs[0];
        scope.require.defined(runtime);
        if (runtime.kind !== 'runtime') {
            throw new Error('Expected a leaf runtime fixture.');
        }
        const matrix = {
            kind: 'runtime-matrix' as const,
            resources: [],
            name: 'api',
            dimensions: {},
            requirements: [],
            variants: [ { id: 'primary', runtime } ]
        };
        const testCase = {
            ...source,
            workId: { ...source.workId, runtimes: [] },
            resourceAttachments: { ...source.resourceAttachments, runtimeGraphs: [ matrix ] }
        };
        scope.assert.equal(caseResourceBoundaryKeys(testCase, new Set([ 'per-run' ])).length, 1);
        scope.assert.throws(function () {
            caseResourceBoundaryKeys({
                ...testCase,
                resourceAttachments: { ...testCase.resourceAttachments, runtimeGraphs: [ { ...matrix, variants: [] } ] }
            }, new Set([ 'per-run' ]));
        }, { message: 'Runtime matrix "api" has no selected variant.' });

        return scope.assert.collect();
    }),
    test('scenario timing controls reusable lifecycle cache identities', function (scope) {
        const first = scenarioCase('first', 'per-file', 'primary');
        const second = scenarioCase('second', 'per-file', 'replica');

        scope.assert.deepEqual(countsForResource([ first, second ], 'database'), [ 1, 1 ]);
        scope.assert.deepEqual(
            countsForResource([
                first,
                scenarioCase('same', 'per-file', 'primary')
            ], 'database'),
            [ 2 ]
        );
        scope.assert.deepEqual(
            countsForResource([
                scenarioCase('routed-first', 'per-file', 'primary', { timing: 'request-routed' }),
                scenarioCase('routed-second', 'per-file', 'replica', { timing: 'request-routed' })
            ], 'database'),
            [ 2 ]
        );
        const dependentCases = [
            scenarioCase('dependent-first', 'per-file', 'primary', {
                dependent: true,
                timing: 'request-routed'
            }),
            scenarioCase('dependent-second', 'per-file', 'replica', {
                dependent: true,
                timing: 'request-routed'
            })
        ];

        scope.assert.deepEqual(countsForResource(dependentCases, 'database'), [ 2 ]);
        scope.assert.deepEqual(countsForResource(dependentCases, 'server'), [ 1, 1 ]);
        scope.assert.deepEqual(caseResourceBoundaryKeys(first, new Set()), []);

        return scope.assert.collect();
    }),
    test('cache identities omit empty state and traverse resource descriptors', function (scope) {
        const empty: ResourceCacheIdentityNode = { workload: null, dependencies: [], scenarios: [] };
        const emptyDependency: ResourceCacheIdentityNode = {
            workload: null,
            dependencies: [ { key: 'empty', resource: empty } ],
            scenarios: []
        };
        const database = defineResource({
            name: 'identity-database',
            scope: 'per-case',
            requirements: [],
            scenarios: {
                database: { default: 'primary', timing: 'acquire', values: [ 'primary', 'replica' ] }
            },
            acquire(context) {
                return context.scenarios.database;
            },
            dispose: null
        });
        const server = defineResource({
            name: 'identity-server',
            scope: 'per-case',
            requirements: [],
            dependencies: { database: bindResourceScenarios(database, { database: 'replica' }) },
            acquire(context) {
                return context.dependencies.database;
            },
            dispose: null
        });
        const serverNode = resourceDescriptorCacheIdentityNode(server);
        const routed: ResourceCacheIdentityNode = {
            workload: null,
            dependencies: [],
            scenarios: [ { name: 'database', timing: 'request-routed', value: 'replica' } ]
        };
        const ordered: ResourceCacheIdentityNode = {
            workload: null,
            dependencies: [
                { key: 'routed', resource: routed },
                {
                    key: 'acquired',
                    resource: {
                        workload: null,
                        dependencies: [],
                        scenarios: [ { name: 'database', timing: 'acquire', value: 'primary' } ]
                    }
                }
            ],
            scenarios: [
                { name: 'second', timing: 'acquire', value: 'second' },
                { name: 'first', timing: 'acquire', value: 'first' }
            ]
        };
        const defaultedNode = resourceDescriptorCacheIdentityNode(bindResourceScenarios(database, {}));

        scope.assert.deepEqual([
            resourceAcquisitionCacheIdentity(empty),
            resourceHandleCacheIdentity(empty),
            resourceAcquisitionCacheIdentity(emptyDependency),
            resourceAcquisitionCacheIdentity(serverNode).includes('replica'),
            resourceHandleCacheIdentity(serverNode).includes('replica'),
            resourceAcquisitionCacheIdentity(defaultedNode).includes('primary'),
            resourceAcquisitionCacheIdentity(routed),
            resourceHandleCacheIdentity(routed).includes('replica'),
            resourceHandleCacheIdentity(ordered) === resourceHandleCacheIdentity(reorderedCacheNode(ordered))
        ], [ '', '', '', true, true, true, '', true, true ]);

        return scope.assert.collect();
    })
]);

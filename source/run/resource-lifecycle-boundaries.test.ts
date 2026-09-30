import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { createCaseId } from '../engine/identity.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import { defineResource } from '../resources/resources.ts';
import { bindResourceScenarios } from '../resources/resource-scenario-binding.ts';
import {
    caseResourceBoundaryKeys,
    resourceLifecycleBoundaryUseCounts
} from './resource-lifecycle-boundaries.ts';
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

function assertScenarioCacheIdentities(scope: TestScope): void {
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
}

function assertCacheIdentityNodes(scope: TestScope): void {
    const empty: ResourceCacheIdentityNode = { dependencies: [], scenarios: [] };
    const emptyDependency: ResourceCacheIdentityNode = {
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
    const replica = bindResourceScenarios(database, { database: 'replica' });
    const server = defineResource({
        name: 'identity-server',
        scope: 'per-case',
        requirements: [],
        dependencies: { database: replica },
        acquire(context) {
            return context.dependencies.database;
        },
        dispose: null
    });
    const serverNode = resourceDescriptorCacheIdentityNode(server);
    const routed: ResourceCacheIdentityNode = {
        dependencies: [],
        scenarios: [ { name: 'database', timing: 'request-routed', value: 'replica' } ]
    };
    const ordered: ResourceCacheIdentityNode = {
        dependencies: [
            { key: 'routed', resource: routed },
            {
                key: 'acquired',
                resource: {
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
        resourceHandleCacheIdentity(ordered) === resourceHandleCacheIdentity({
            dependencies: ordered.dependencies.toReversed(),
            scenarios: ordered.scenarios.toReversed()
        })
    ], [ '', '', '', true, true, true, '', true, true ]);
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/resource-lifecycle-boundaries.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'scenario timing controls reusable lifecycle cache identities',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertScenarioCacheIdentities(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'cache identities omit empty state and traverse resource descriptors',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertCacheIdentityNodes(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

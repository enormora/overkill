import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { createCaseId } from '../engine/identity.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import { resourceLifecycleBoundaryUseCounts } from './resource-lifecycle-boundaries.ts';

type ScenarioCaseOptions = {
    readonly dependent?: boolean;
    readonly timing?: 'acquire' | 'request-routed';
};

function scenarioCase(title: string, scope: string, value: string, options: ScenarioCaseOptions = {}): TestPlanCase {
    const id = createCaseId('scenario.test.ts', [ 'suite' ], title, null);
    const timing = options.timing ?? 'acquire';
    const resourceGraph = [
        {
            dependencies: [],
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
            runtimes: [ { dimensions: {}, name: 'api', variantId: null } ],
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
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

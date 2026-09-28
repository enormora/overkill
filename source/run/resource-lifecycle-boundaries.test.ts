import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { createCaseId } from '../engine/identity.ts';
import type { TestPlanCase } from '../engine/test-plan.ts';
import { resourceLifecycleBoundaryUseCounts } from './resource-lifecycle-boundaries.ts';

function scenarioCase(title: string, scope: string, value: string): TestPlanCase {
    const id = createCaseId('scenario.test.ts', [ 'suite' ], title, null);

    return {
        annotations: { ownership: [], tags: [] },
        controls: { capture: null, duplicateExecution: null, timeoutMilliseconds: null },
        definitionLocations: [ { kind: 'unknown' } ],
        execution: { kind: 'skip', reason: 'planning only' },
        id,
        resourceAttachments: {
            directResources: [],
            resourceGraph: [ {
                dependencies: [],
                name: 'database',
                requirements: [],
                scenarios: [ {
                    default: 'primary',
                    name: 'database',
                    timing: 'acquire',
                    values: [ 'primary', 'replica' ]
                } ],
                scope
            } ],
            runtimeGraphs: [ {
                dimensions: {},
                kind: 'runtime',
                name: 'api',
                requirements: [],
                resources: [ { key: 'database', resourceName: 'database' } ],
                scenarioBindings: [ {
                    default: 'primary',
                    name: 'database',
                    owner: { path: [ 'database' ], resourceName: 'database' },
                    timing: 'acquire',
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

function assertReusableBoundaryConflicts(scope: TestScope): void {
    const first = scenarioCase('first', 'per-file', 'primary');
    const second = scenarioCase('second', 'per-file', 'replica');

    scope.assert.throws(function rejectConflictingBindings() {
        resourceLifecycleBoundaryUseCounts([ first, second ]);
    }, {
        message: 'Resource "database" scenario "database" has conflicting values ' +
            '"primary" and "replica" within one per-file lifecycle boundary.'
    });
    scope.assert.equal(
        resourceLifecycleBoundaryUseCounts([
            first,
            scenarioCase('same', 'per-file', 'primary')
        ])
            .length > 0,
        true
    );
    scope.assert.equal(
        resourceLifecycleBoundaryUseCounts([
            scenarioCase('case-first', 'per-case', 'primary'),
            scenarioCase('case-second', 'per-case', 'replica')
        ])
            .length > 0,
        true
    );
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/resource-lifecycle-boundaries.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'scenario bindings reject conflicting reusable lifecycle boundaries',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertReusableBoundaryConflicts(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

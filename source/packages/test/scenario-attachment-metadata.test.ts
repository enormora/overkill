import {
    createSuite,
    createTestCase,
    readTestBodyResourceAttachments,
    type TestScope
} from '../engine/engine.entry-point.ts';
import * as resources from './resources.entry-point.ts';

function assertScenarioAttachmentMetadata(scope: TestScope): void {
    const resource = resources.defineResource({
        name: 'scenario-database',
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
    const runtime = resources
        .defineRuntime({
            name: 'scenario-api',
            dimensions: {},
            resources: { database: resource },
            requirements: []
        })
        .scenario({ database: 'replica' });
    const body = resources.withRuntime(runtime, function runWithScenario(runtimeScope) {
        return runtimeScope.assert.collect();
    });
    const attachments = readTestBodyResourceAttachments(body);
    const resourceSummary = attachments.resourceGraph[0];
    const runtimeSummary = attachments.runtimeGraphs[0];

    scope.require.defined(resourceSummary);
    scope.require.defined(runtimeSummary);
    scope.assert.deepEqual(resourceSummary.scenarios, [ {
        default: 'primary',
        name: 'database',
        timing: 'acquire',
        values: [ 'primary', 'replica' ]
    } ]);
    scope.assert.deepEqual(runtimeSummary, {
        dimensions: {},
        kind: 'runtime',
        name: 'scenario-api',
        requirements: [],
        resources: [ { key: 'database', resourceName: 'scenario-database' } ],
        scenarioBindings: [ {
            default: 'primary',
            name: 'database',
            owner: { path: [ 'database' ], resourceName: 'scenario-database' },
            timing: 'acquire',
            value: 'replica',
            values: [ 'primary', 'replica' ]
        } ]
    });
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/scenario-attachment-metadata.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'runtime scenario metadata records owners and selected values',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertScenarioAttachmentMetadata(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

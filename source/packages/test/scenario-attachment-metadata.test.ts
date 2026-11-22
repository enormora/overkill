import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test, type TestScope } from '@overkill-dev/test';

import { readTestBodyResourceAttachments } from '../engine/engine.entry-point.ts';

import * as resources from './resources.entry-point.ts';

export const testNode = suite('Scenario attachment metadata', [
    test('runtime scenario metadata records owners and selected values', function (scope: TestScope) {
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
        scope.assert(
            defineCompositeAssertion({
                name: 'runtime scenario metadata records owners and selected values',
                assert(check) {
                    return check.group([
                        check.deepEqual(resourceSummary.scenarios, [ {
                            default: 'primary',
                            name: 'database',
                            timing: 'acquire',
                            values: [ 'primary', 'replica' ]
                        } ]),
                        check.deepEqual(runtimeSummary, {
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
                        })
                    ]);
                }
            })
        );

        return scope.assert.collect();
    })
]);

import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { defineResource } from './resources.ts';
import { resourceScenarioOwners } from './resource-scenario-binding.ts';

function defineResourceWithScenarios(scenarios: unknown): void {
    Reflect.apply(defineResource, undefined, [ {
        acquire() {
            return 'handle';
        },
        dispose: null,
        name: 'invalid-scenarios',
        requirements: [],
        scenarios,
        scope: 'per-case'
    } ]);
}

function assertResourceScenarioValidation(scope: TestScope): void {
    const invalidScenarios = [
        { message: 'Resource scenarios must be an object.', scenarios: null },
        { message: 'Scenario slot "mode" is invalid.', scenarios: { mode: null } },
        { message: 'Scenario slot "mode" is invalid.', scenarios: { mode: 'default' } },
        {
            message: 'Scenario slot "mode" is invalid.',
            scenarios: { mode: { default: 1, timing: 'acquire', values: [ 'default' ] } }
        },
        {
            message: 'Scenario slot "mode" is invalid.',
            scenarios: { mode: { default: 'default', timing: 'invalid', values: [ 'default' ] } }
        },
        {
            message: 'Scenario slot "mode" is invalid.',
            scenarios: { mode: { default: 'default', timing: 'acquire', values: null } }
        },
        {
            message: 'Scenario slot "mode" is invalid.',
            scenarios: { mode: { default: 'default', timing: 'acquire', values: [] } }
        },
        {
            message: 'Scenario slot "mode" is invalid.',
            scenarios: { mode: { default: 'default', timing: 'acquire', values: [ 'default', 1 ] } }
        },
        {
            message: 'Scenario slot "invalid slot" must match ^[A-Za-z0-9._-]+$.',
            scenarios: {
                'invalid slot': { default: 'default', timing: 'acquire', values: [ 'default' ] }
            }
        },
        {
            message: 'Scenario slot "mode" contains duplicate values.',
            scenarios: {
                mode: { default: 'default', timing: 'acquire', values: [ 'default', 'default' ] }
            }
        },
        {
            message: 'Scenario slot "mode" default "missing" is not declared.',
            scenarios: { mode: { default: 'missing', timing: 'acquire', values: [ 'default' ] } }
        }
    ];

    for (const invalid of invalidScenarios) {
        scope.assert.throws(function rejectInvalidScenarios() {
            defineResourceWithScenarios(invalid.scenarios);
        }, { message: invalid.message });
    }

    scope.assert.equal(
        resourceScenarioOwners(
            ({
                invalid: {
                    acquire() {
                        return 'handle';
                    },
                    dependencies: {},
                    dispose: null,
                    name: 'invalid',
                    requirements: [],
                    scenarios: { mode: null },
                    scope: 'per-case'
                }
            }) as never
        )
            .size,
        0
    );
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/resources/resource-scenario-validation.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'defineResource rejects malformed scenario slots',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertResourceScenarioValidation(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

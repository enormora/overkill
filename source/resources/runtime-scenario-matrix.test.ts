import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    defineResource,
    defineRuntime,
    resolvedRuntimeScenarioOwners,
    type EmptyResourceDependencies,
    type ResourceDefinition,
    type ResourceScenarioSlot,
    type RuntimeDefinition
} from './resources.ts';
import { runtimeMatrixDefinitionApi } from './runtime-matrix-definition.ts';

const { defineRuntimeMatrix } = runtimeMatrixDefinitionApi;

type ScenarioResource = ResourceDefinition<
    string,
    string,
    EmptyResourceDependencies,
    unknown,
    Readonly<Record<'mode', ResourceScenarioSlot>>
>;

function scenarioResource(name: string, values: readonly [string, ...string[]]): ScenarioResource {
    return defineResource({
        name,
        scope: 'per-case',
        requirements: [],
        scenarios: { mode: { default: 'default', timing: 'acquire', values } },
        acquire(context) {
            return context.scenarios.mode;
        },
        dispose: null
    });
}

function scenarioRuntime(name: string, variant: string, resource: ScenarioResource): RuntimeDefinition {
    return defineRuntime({
        name,
        dimensions: { variant },
        resources: { scenario: resource },
        requirements: []
    });
}

function assertRuntimeMatrixScenarios(scope: TestScope): void {
    const firstResource = scenarioResource('first-scenario', [ 'default', 'alternate' ]);
    const secondResource = scenarioResource('second-scenario', [ 'default', 'other' ]);

    scope.assert.throws(function rejectDifferentScenarioSlots() {
        defineRuntimeMatrix({
            name: 'scenario',
            variants: {
                first: scenarioRuntime('first', 'first', firstResource),
                second: scenarioRuntime('second', 'second', secondResource)
            }
        });
    }, { message: 'Runtime matrix "scenario" variant "second" has different scenario slots.' });

    const matrix = defineRuntimeMatrix({
        name: 'scenario',
        variants: {
            first: scenarioRuntime('first', 'first', firstResource),
            second: scenarioRuntime('second', 'second', firstResource)
        }
    })
        .scenario({ mode: 'alternate' });

    scope.assert.equal(
        resolvedRuntimeScenarioOwners(matrix.variants.first.runtime).get('mode')?.value,
        'alternate'
    );
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/resources/runtime-scenario-matrix.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'runtime matrices bind scenarios and require matching slots',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertRuntimeMatrixScenarios(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);

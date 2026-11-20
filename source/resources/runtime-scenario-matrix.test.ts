import { type TestNode, suite, test, type TestScope } from '@overkill-dev/test';

import {
    defineResource,
    defineRuntime,
    resolvedRuntimeScenarioOwners,
    type EmptyResourceDependencies,
    type ResourceDefinition,
    type RuntimeDefinition
} from './resources.ts';
import type { ResourceScenarioSlot } from './resource-scenario.ts';
import { runtimeMatrixDefinitionApi } from './runtime-matrix-definition.ts';

const { defineRuntimeMatrix } = runtimeMatrixDefinitionApi;

type ScenarioResource = ResourceDefinition<
    string,
    string,
    EmptyResourceDependencies,
    unknown,
    Readonly<Record<'mode', ResourceScenarioSlot<string, 'acquire'>>>
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

    const defaultMatrix = defineRuntimeMatrix({
        name: 'scenario',
        variants: {
            first: scenarioRuntime('first', 'first', firstResource),
            second: scenarioRuntime('second', 'second', firstResource)
        }
    });
    const matrix = defaultMatrix.scenario({ mode: 'alternate' });

    scope.assert.deepEqual(defaultMatrix.variants.first.runtime.id.scenarios, { mode: 'default' });
    scope.assert.deepEqual(matrix.variants.first.runtime.id.scenarios, { mode: 'alternate' });

    scope.assert.equal(
        resolvedRuntimeScenarioOwners(matrix.variants.first.runtime).get('mode')?.value,
        'alternate'
    );
}

export const testNode: TestNode = suite('Runtime scenario matrix', [
    test('runtime matrices bind scenarios and require matching slots', function (scope) {
        assertRuntimeMatrixScenarios(scope);

        return scope.assert.collect();
    })
]);

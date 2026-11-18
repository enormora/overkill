import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { defineResource, defineRuntime } from '../resources/resources.ts';
import { runtimeMatrixDefinitionApi } from '../resources/runtime-matrix-definition.ts';
import { createCaseId, createDefaultWorkId, type WorkId } from '../engine/identity.ts';
import { managedResourceSession } from './resource-lifecycle-managed-session.ts';
import {
    combinedResourceEntries,
    composedResourceSession,
    runtimeContextForStep,
    lifecycleScenarioBindings
} from './resource-lifecycle-composition.ts';

const connection = defineResource({
    name: 'connection',
    scope: 'per-case',
    dependencies: {},
    requirements: [],
    scenarios: { mode: { default: 'default', timing: 'acquire', values: [ 'default', 'alternate' ] } },
    acquire(context) {
        return context.scenarios.mode;
    },
    dispose: null
});
const service = defineResource({
    name: 'service',
    scope: 'per-case',
    dependencies: { connection },
    requirements: [],
    acquire(context) {
        return context.dependencies.connection;
    },
    dispose: null
});
const runtime = defineRuntime({
    name: 'transport',
    dimensions: { backend: 'unit' },
    resources: { service },
    requirements: []
});
const matrix = runtimeMatrixDefinitionApi
    .defineRuntimeMatrix({ name: 'transport-matrix', variants: { first: runtime } })
    .scenario({ mode: 'alternate' });
const steps = [ { kind: 'runtime', runtime: matrix } ] as const;
function selectedWork(variantId: string | null): WorkId {
    return {
        ...createDefaultWorkId(createCaseId('matrix.test.ts', [], 'case', null)),
        runtimes: [ { ...runtime.id, name: matrix.name, variantId } ]
    };
}
export const testNode = suite('runner managed runtime composition', [
    test('requires runner selection before composing runtime matrix resources', function (scope: TestScope) {
        scope.assert.throws(function () {
            return combinedResourceEntries(steps, null);
        }, {
            message: 'Runtime matrix "transport-matrix" requires runner-managed execution.'
        });
        scope.assert.throws(function () {
            return combinedResourceEntries(steps, { ...selectedWork('first'), runtimes: [] });
        }, {
            message: 'Runtime matrix "transport-matrix" requires runner-managed execution.'
        });
        return scope.assert.collect();
    }),
    test('rejects missing and unknown matrix variant selections', function (scope: TestScope) {
        scope.assert.throws(function () {
            return combinedResourceEntries(steps, selectedWork(null));
        }, {
            message: 'Runtime matrix "transport-matrix" has no selected variant for this work item.'
        });
        scope.assert.throws(function () {
            return combinedResourceEntries(steps, selectedWork('unknown'));
        }, {
            message: 'Runtime matrix "transport-matrix" has no variant "unknown".'
        });
        return scope.assert.collect();
    }),
    test('scopes dependencies and acquisition scenario bindings to the selected runtime', function (scope: TestScope) {
        const resources = combinedResourceEntries(steps, selectedWork('first'));
        const [ scoped ] = Object.values(resources);
        scope.require.defined(scoped);
        scope.assert.includes(scoped.name, 'service@');
        const dependency = scoped.dependencies['connection'];
        scope.require.defined(dependency);
        scope.assert.includes(dependency.name, 'connection@');
        scope.assert.deepEqual(lifecycleScenarioBindings(dependency), { mode: 'alternate' });
        return scope.assert.collect();
    }),
    test('reuses the same scoped resource identity for repeated runtime acquisition', function (scope: TestScope) {
        const first = combinedResourceEntries(steps, selectedWork('first'));
        const second = combinedResourceEntries(steps, selectedWork('first'));
        scope.assert.equal(Object.values(first)[0], Object.values(second)[0]);
        return scope.assert.collect();
    }),
    test('exposes selected matrix handles through composed runtime contexts', async function (scope: TestScope) {
        const work = selectedWork('first');
        const resources = combinedResourceEntries(steps, work);
        const handles = new Map(
            Object.values(resources).map(function (resource) {
                return [ resource, 'service handle' ];
            })
        );
        const session = managedResourceSession(resources, handles, function () {
            return [];
        });
        const composed = composedResourceSession({}, [ matrix ], session, work);
        scope.assert.deepEqual(runtimeContextForStep(matrix, composed), { service: 'service handle' });
        await composed.disposeOnce({ signal: AbortSignal.any([]) });
        return scope.assert.collect();
    }),
    test('reassembles nested composed runtime handles without losing matrix selection', function (scope: TestScope) {
        const work = selectedWork('first');
        const resources = combinedResourceEntries(steps, work);
        const handles = new Map(
            Object.values(resources).map(function (resource) {
                return [ resource, 'service handle' ];
            })
        );
        const session = managedResourceSession(resources, handles, function () {
            return [];
        });
        const composed = composedResourceSession({}, [ matrix ], session, work);
        const graph = runtimeMatrixDefinitionApi.composeRuntimes(matrix);
        scope.assert.deepEqual(runtimeContextForStep(graph, composed), {
            'transport-matrix': { service: 'service handle' }
        });
        return scope.assert.collect();
    })
]);

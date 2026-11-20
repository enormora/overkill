import { table, type TestNode, suite, test } from '@overkill-dev/test';

import { defineResource, defineRuntime, composeRuntimes } from '../resources/resources.entry-point.ts';

import { composeRuntimeScope } from './resource-wrapper-runtime-scope.ts';

const resource = defineResource({
    name: 'value',
    scope: 'per-case',
    requirements: [],
    acquire() {
        return 'handle';
    },
    dispose: null
});
const api = defineRuntime({ name: 'api', dimensions: {}, resources: { value: resource }, requirements: [] });
const worker = defineRuntime({ name: 'worker', dimensions: {}, resources: { value: resource }, requirements: [] });
const composed = composeRuntimes(api, worker);
export const testNode: TestNode = suite('runtime wrapper scope composition', [
    test('preserves existing runtime scopes and freezes newly composed contexts', function (scope) {
        const context = composeRuntimeScope({ ...scope, runtimes: { existing: { value: 'original' } } }, api, {
            value: 'api'
        });
        scope.assert.deepEqual(context.runtimes, { existing: { value: 'original' }, api: { value: 'api' } });
        scope.assert.true(Object.isFrozen(context));
        scope.assert.true(Object.isFrozen(context.runtimes));
        return scope.assert.collect();
    }),
    test('composes every runtime in a shared graph', function (scope) {
        const context = composeRuntimeScope(scope, composed, { api: { value: 'api' }, worker: { value: 'worker' } });
        scope.assert.deepEqual(context.runtimes, { api: { value: 'api' }, worker: { value: 'worker' } });
        return scope.assert.collect();
    }),
    test('rejects duplicate runtime scopes before replacing existing values', function (scope) {
        const runtimes = { api: { value: 'existing' } };
        scope.assert.throws(function () {
            composeRuntimeScope({ ...scope, runtimes }, api, { value: 'replacement' });
        }, { message: 'Runtime scope "api" already exists.' });
        scope.assert.deepEqual(runtimes, { api: { value: 'existing' } });
        return scope.assert.collect();
    }),
    table({
        title: 'rejects invalid runtime scope map',
        cases: [ null, [], 'invalid' ],
        caseTitle(_parameters, index) {
            return `${index}`;
        },
        test(scope) {
            const runtimes = scope.parameters;

            scope.assert.throws(function () {
                Reflect.apply(composeRuntimeScope, undefined, [ { ...scope, runtimes }, api, { value: 'api' } ]);
            }, { message: 'Runtime scope composition failed.' });
            return scope.assert.collect();
        }
    }),
    test('rejects missing handles for individual and composed runtimes', function (scope) {
        scope.assert.throws(function () {
            Reflect.apply(composeRuntimeScope, undefined, [ scope, api, undefined ]);
        }, { message: 'Runtime scope composition failed.' });
        scope.assert.throws(function () {
            Reflect.apply(composeRuntimeScope, undefined, [ scope, composed, { api: { value: 'api' } } ]);
        }, { message: 'Runtime scope composition failed.' });
        return scope.assert.collect();
    })
]);

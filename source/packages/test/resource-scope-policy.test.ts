import { runIfMain } from '#test-runner';
import {
    attachTestBodyResourceAttachments,
    readTestBodyResourceAttachments,
    type AssertionResult
} from '../engine/engine.entry-point.ts';
import { mappedResourceScope } from '../../test-support/mapped-resource-scope.ts';
import { suite, test, type TestScope } from './test.entry-point.ts';
import { defineResource, withResource } from './resources.entry-point.ts';

const resource = defineResource({
    name: 'value',
    scope: 'per-case',
    requirements: [],
    acquire() {
        return 'handle';
    },
    dispose: null
});
function body(scope: TestScope): AssertionResult {
    return scope.assert.collect();
}
export const testNode = suite('resource wrapper scope validation', [
    ...[ null, [], 'invalid' ].map(function (resources, index) {
        return test(`rejects malformed resource maps ${index}`, async function (scope: TestScope) {
            const wrapped = withResource(resource, body);
            const supplied = { ...scope, resources };
            await scope.assert.rejects(async function () {
                await wrapped(supplied);
            }, { message: 'Resource scope composition failed.' });
            return scope.assert.collect();
        });
    }),
    test('rejects collisions without changing the existing resource map', async function (scope: TestScope) {
        const wrapped = withResource(resource, body);
        const resources = { value: 'existing' };
        await scope.assert.rejects(async function () {
            const supplied = { ...scope, resources };
            await wrapped(supplied);
        }, { message: 'Resource scope "value" already exists.' });
        scope.assert.deepEqual(resources, { value: 'existing' });
        return scope.assert.collect();
    }),
    test('requires callable resource bodies', function (scope: TestScope) {
        scope.assert.throws(function () {
            Reflect.apply(withResource, undefined, [ resource, null ]);
        }, { message: 'withResource() requires a body function.' });
        return scope.assert.collect();
    }),
    test('requires first-party composition metadata when wrapping an attached body', function (scope: TestScope) {
        const wrapped = withResource(resource, body);
        const metadata = readTestBodyResourceAttachments(wrapped);
        const foreign = attachTestBodyResourceAttachments(function (inner: TestScope) {
            return inner.assert.collect();
        }, metadata);
        scope.assert.throws(function () {
            withResource(resource, foreign);
        }, { message: 'withResource() requires first-party resource wrapper metadata for wrapped bodies.' });
        return scope.assert.collect();
    }),
    ...[ null, [], 'invalid', {
        then() {
            return undefined;
        }
    } ]
        .map(function (value, index) {
            return test(`rejects invalid mapped scope results ${index}`, async function (scope: TestScope) {
                await scope.assert.rejects(async function () {
                    await mappedResourceScope(value, scope);
                }, { message: 'withMapped must return an object.' });
                return scope.assert.collect();
            });
        }),
    test('forwards valid mapped scope values into the body', async function (scope: TestScope) {
        scope.assert.equal(await mappedResourceScope({ tag: 'mapped' }, scope), 'mapped');
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);

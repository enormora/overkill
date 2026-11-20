import { table, type TestNode, suite, test } from '@overkill-dev/test';
import type { EngineCaseBody } from '../../../../test-support/create-test-engine.ts';

import {
    attachTestBodyResourceAttachments,
    readTestBodyResourceAttachments
} from '../../../../packages/engine/engine.entry-point.ts';
import { mappedResourceScope } from '../../../../test-support/mapped-resource-scope.ts';

import { defineResource, withResource } from '../../../../packages/test/resources.entry-point.ts';

const resource = defineResource({
    name: 'value',
    scope: 'per-case',
    requirements: [],
    acquire() {
        return 'handle';
    },
    dispose: null
});
const body: EngineCaseBody = function (scope) {
    return scope.assert.collect();
};
export const testNode: TestNode = suite('resource wrapper scope validation', [
    table({
        title: 'rejects malformed resource maps',
        cases: [ { description: 'null', input: null }, { description: 'array', input: [] }, {
            description: 'string',
            input: 'invalid'
        } ],
        caseTitle({ description }) {
            return description;
        },
        async test(scope) {
            const resources = scope.parameters.input;

            const wrapped = withResource(resource, body);
            const supplied = { ...scope, resources };
            await scope.assert.rejects(async function () {
                const result: unknown = Reflect.apply(wrapped, undefined, [ supplied ]);
                await result;
            }, { message: 'Resource scope composition failed.' });
            return scope.assert.collect();
        }
    }),
    test('rejects collisions without changing the existing resource map', async function (scope) {
        const wrapped = withResource(resource, body);
        const resources = { value: 'existing' };
        await scope.assert.rejects(async function () {
            const supplied = { ...scope, resources };
            const result: unknown = Reflect.apply(wrapped, undefined, [ supplied ]);
            await result;
        }, { message: 'Resource scope "value" already exists.' });
        scope.assert.deepEqual(resources, { value: 'existing' });
        return scope.assert.collect();
    }),
    test('requires callable resource bodies', function (scope) {
        scope.assert.throws(function () {
            Reflect.apply(withResource, undefined, [ resource, null ]);
        }, { message: 'withResource() requires a body function.' });
        return scope.assert.collect();
    }),
    test(
        'requires first-party composition metadata when wrapping an attached body',
        function (scope) {
            const wrapped = withResource(resource, body);
            const metadata = readTestBodyResourceAttachments(wrapped);
            const foreign = attachTestBodyResourceAttachments<
                Parameters<EngineCaseBody>[0],
                ReturnType<EngineCaseBody>
            >(function (inner) {
                return inner.assert.collect();
            }, metadata);
            scope.assert.throws(function () {
                withResource(resource, foreign);
            }, { message: 'withResource() requires first-party resource wrapper metadata for wrapped bodies.' });
            return scope.assert.collect();
        }
    ),
    table({
        title: 'rejects invalid mapped scope results',
        cases: [ { description: 'null', input: null }, { description: 'array', input: [] }, {
            description: 'string',
            input: 'invalid'
        }, {
            description: 'thenable',
            input: {
                then() {
                    return undefined;
                }
            }
        } ],
        caseTitle({ description }) {
            return description;
        },
        async test(scope) {
            const value = scope.parameters.input;

            await scope.assert.rejects(async function () {
                await mappedResourceScope(value, scope);
            }, { message: 'withMapped must return an object.' });
            return scope.assert.collect();
        }
    }),
    test('forwards valid mapped scope values into the body', async function (scope) {
        scope.assert.equal(await mappedResourceScope({ tag: 'mapped' }, scope), 'mapped');
        return scope.assert.collect();
    })
]);

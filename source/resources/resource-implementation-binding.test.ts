import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import { resourceImplementationBinding } from '../test-support/resource-implementation-binding.ts';

import { defineResourceReference } from './resource-reference.ts';
import { resourceImplementationParticipants } from './resource-implementation-participants.ts';
import { resourceReferenceCallbacks } from './resource-reference-binding.ts';

const resourceDeclaration = {
    name: 'registry',
    scope: 'per-file',
    dependencies: {},
    requirements: [],
    scenarios: {},
    workload: null
} as const;
export const testNode: TestNode = suite('resource implementation binding', [
    test('binds owner acquisition, disposal, projection and scenario exposure', async function (scope: TestScope) {
        const fixture = resourceImplementationBinding();
        const callbacks = fixture.owner.bind(fixture.admission);
        const handle = await callbacks.acquire(fixture.context);
        scope.require.defined(callbacks.dispose);
        scope.require.defined(callbacks.serializeHandle);
        scope.require.defined(callbacks.exposeHandle);
        const observed = {
            exposed: callbacks.exposeHandle(handle, fixture.context).href,
            projected: callbacks.serializeHandle(handle, fixture.context)
        };
        await callbacks.dispose(handle, fixture.context);
        scope.assert.deepEqual({ handle: handle.href, ...observed, events: fixture.events }, {
            handle: 'file:///resource',
            exposed: 'file:///resource#second',
            projected: { url: 'file:///resource' },
            events: [ 'acquire', 'dispose:file:///resource:file:///resource' ]
        });
        return scope.assert.collect();
    }),
    test('preserves absent owner callbacks', function (scope) {
        const fixture = resourceImplementationBinding();
        const callbacks = fixture.owner.bind({
            ...fixture.admission,
            namespace: {
                resource: {
                    version: '1',
                    implementation: {
                        ...fixture.ownerImplementation,
                        dispose: null,
                        serializeHandle: null,
                        exposeHandle: null
                    }
                }
            }
        });
        scope.assert.deepEqual({
            dispose: callbacks.dispose,
            serialize: callbacks.serializeHandle,
            expose: callbacks.exposeHandle
        }, { dispose: null, serialize: null, expose: null });
        return scope.assert.collect();
    }),
    test('rejects changed admitted inputs before calling the owner', function (scope) {
        const fixture = resourceImplementationBinding();
        scope.assert.throws(function () {
            return fixture.owner.bind({
                ...fixture.admission,
                facts: { ...fixture.admission.facts, input: { prefix: 'changed' } }
            });
        }, { message: 'Resource implementation inputs changed; prepare and collect a new run.' });
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    }),
    test('rejects invalid owner callback shapes', function (scope) {
        const fixture = resourceImplementationBinding();
        for (const field of [ 'acquire', 'dispose', 'exposeHandle', 'serializeHandle' ]) {
            scope.assert.throws(function () {
                return fixture.owner.bind({
                    ...fixture.admission,
                    namespace: {
                        resource: { version: '1', implementation: { ...fixture.ownerImplementation, [field]: 42 } }
                    }
                });
            }, { message: /Invalid input/u });
        }
        return scope.assert.collect();
    }),
    test('binds portable consumer projections and scenario exposure', function (scope: TestScope) {
        const fixture = resourceImplementationBinding();
        const callbacks = fixture.consumer.bind({
            ...fixture.admission,
            namespace: { resource: { version: '1', implementation: fixture.consumerImplementation } }
        });
        const handle = callbacks.deserializeHandle({ url: 'file:///owner' }, fixture.context);
        scope.require.defined(callbacks.exposeHandle);
        scope.assert.deepEqual(callbacks.exposeHandle(handle, fixture.context), {
            address: 'file:///owner:file:///resource#second'
        });
        return scope.assert.collect();
    }),
    test('preserves absent consumer exposure and rejects native projection payloads', function (scope) {
        const fixture = resourceImplementationBinding();
        const callbacks = fixture.consumer.bind({
            ...fixture.admission,
            namespace: {
                resource: { version: '1', implementation: { ...fixture.consumerImplementation, exposeHandle: null } }
            }
        });
        scope.assert.equal(callbacks.exposeHandle, null);
        scope.assert.throws(function () {
            const payload = { url: 'file:///native' };
            Object.setPrototypeOf(payload, URL.prototype);
            return callbacks.deserializeHandle(payload, fixture.context);
        }, { message: 'Portable inputs require lossless, acyclic JSON.' });
        return scope.assert.collect();
    }),
    test('rejects invalid consumer callbacks', function (scope) {
        const fixture = resourceImplementationBinding();
        for (const field of [ 'deserializeHandle', 'exposeHandle' ]) {
            scope.assert.throws(function () {
                return fixture.consumer.bind({
                    ...fixture.admission,
                    namespace: {
                        resource: { version: '1', implementation: { ...fixture.consumerImplementation, [field]: 42 } }
                    }
                });
            }, { message: /Invalid input/u });
        }
        return scope.assert.collect();
    }),
    test('requires an owner projection when consumers are declared', function (scope: TestScope) {
        const fixture = resourceImplementationBinding();
        const resource = defineResourceReference({
            ...resourceDeclaration,
            owner: fixture.owner,
            consumer: fixture.consumer
        });
        const owner = resourceImplementationParticipants({ resource }).find(function (participant) {
            return participant.role === 'resource-owner';
        });
        scope.require.defined(owner);
        scope.assert.throws(function () {
            return owner.bind(
                {
                    resource: {
                        version: '1',
                        implementation: { ...fixture.ownerImplementation, serializeHandle: null }
                    }
                },
                fixture.admission.facts,
                fixture.admission.context
            );
        }, { message: 'Resource "registry" requires an owner projection.' });
        return scope.assert.collect();
    }),
    test('requires owner exposure for request-routed scenarios without a consumer', function (scope: TestScope) {
        const fixture = resourceImplementationBinding();
        const resource = defineResourceReference({
            ...resourceDeclaration,
            owner: fixture.owner,
            consumer: null,
            scenarios: { mode: { default: 'first', values: [ 'first', 'second' ], timing: 'request-routed' } }
        });
        const owner = resourceImplementationParticipants({ resource })[0];
        scope.require.defined(owner);
        scope.assert.throws(function () {
            return owner.bind(
                { resource: { version: '1', implementation: { ...fixture.ownerImplementation, exposeHandle: null } } },
                fixture.admission.facts,
                fixture.admission.context
            );
        }, { message: 'Request-routed resource scenarios require an owner handle exposure.' });
        return scope.assert.collect();
    }),
    test('requires consumer exposure for request-routed scenarios', function (scope: TestScope) {
        const fixture = resourceImplementationBinding();
        const resource = defineResourceReference({
            ...resourceDeclaration,
            owner: fixture.owner,
            consumer: fixture.consumer,
            scenarios: { mode: { default: 'first', values: [ 'first', 'second' ], timing: 'request-routed' } }
        });
        const consumer = resourceImplementationParticipants({ resource }).find(function (participant) {
            return participant.role === 'resource-consumer';
        });
        scope.require.defined(consumer);
        scope.assert.throws(function () {
            return consumer.bind(
                {
                    resource: {
                        version: '1',
                        implementation: { ...fixture.consumerImplementation, exposeHandle: null }
                    }
                },
                fixture.admission.facts,
                fixture.admission.context
            );
        }, { message: 'Request-routed resource scenarios require a consumer handle exposure.' });
        return scope.assert.collect();
    }),
    test('activates consumer bindings only inside their admitted operation', async function (scope: TestScope) {
        const fixture = resourceImplementationBinding();
        const resource = defineResourceReference({
            ...resourceDeclaration,
            owner: fixture.owner,
            consumer: fixture.consumer
        });
        const consumer = resourceImplementationParticipants({ resource }).find(function (participant) {
            return participant.role === 'resource-consumer';
        });
        scope.require.defined(consumer);
        const activation = consumer.bind(
            { resource: { version: '1', implementation: fixture.consumerImplementation } },
            fixture.admission.facts,
            fixture.admission.context
        );
        const name = await activation.run(async function () {
            return resourceReferenceCallbacks(resource).name;
        });
        scope.assert.equal(name, 'registry');
        scope.assert.throws(function () {
            return resourceReferenceCallbacks(resource);
        }, { message: 'Resource "registry" requires prepared implementation admission.' });
        return scope.assert.collect();
    }),
    test('activates owner bindings and restores their previous scope', async function (scope: TestScope) {
        const fixture = resourceImplementationBinding();
        const resource = defineResourceReference({ ...resourceDeclaration, owner: fixture.owner, consumer: null });
        const owner = resourceImplementationParticipants({ resource })[0];
        scope.require.defined(owner);
        const activation = owner.bind(fixture.admission.namespace, fixture.admission.facts, fixture.admission.context);
        const projected = await activation.run(async function () {
            return Object.hasOwn(resourceReferenceCallbacks(resource), 'serializeHandle');
        });
        scope.assert.equal(projected, true);
        scope.assert.equal(Object.hasOwn(resourceReferenceCallbacks(resource), 'serializeHandle'), false);
        return scope.assert.collect();
    })
]);

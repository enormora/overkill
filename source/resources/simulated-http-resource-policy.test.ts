import { type TestScope, suite, test } from '@overkill-dev/test';

import { simulatedHttpResource } from '../test-support/simulated-http-resource.ts';

export const testNode = suite('simulated HTTP resource ownership', [
    test('acquires a routed handle with preserved service endpoint and transcript', async function (scope: TestScope) {
        const fixture = simulatedHttpResource([]);
        const handle = await fixture.service.acquire(fixture.context);
        scope.assert.deepEqual({
            baseUrl: handle.baseUrl,
            entries: handle.transcript.entryCount,
            frozen: Object.isFrozen(handle)
        }, { baseUrl: 'http://127.0.0.1:4321', entries: 0, frozen: true });
        scope.assert.equal(
            handle.scenarioUrl('offline', '/path?q=1'),
            'http://127.0.0.1:4321/path?q=1&__overkill_scenario=offline'
        );
        scope.require.defined(fixture.service.dispose);
        await fixture.service.dispose(handle, fixture.context);
        await fixture.service.dispose(handle, fixture.context);
        scope.assert.deepEqual(fixture.calls, [ 'listen:127.0.0.1:0', 'close' ]);
        return scope.assert.collect();
    }),
    test('exposes selected request-routed scenarios without restarting the server', async function (scope: TestScope) {
        const fixture = simulatedHttpResource([]);
        const handle = await fixture.service.acquire(fixture.context);
        const exposed = fixture.service.exposeHandle(handle, {
            attachments: fixture.context.attachments,
            scenarios: { service: 'offline' }
        });
        scope.assert.equal(exposed.baseUrl, 'http://127.0.0.1:4321/?__overkill_scenario=offline');
        scope.assert.equal(exposed.transcript, handle.transcript);
        scope.assert.equal(exposed.endpoint, handle.endpoint);
        scope.require.defined(fixture.service.dispose);
        await fixture.service.dispose(handle, fixture.context);
        scope.assert.deepEqual(fixture.calls, [ 'listen:127.0.0.1:0', 'close' ]);
        return scope.assert.collect();
    }),
    test('refuses acquisition after cancellation', async function (scope) {
        const fixture = simulatedHttpResource([]);
        const failure = new Error('Cancelled resource.');
        const controller = new AbortController();
        controller.abort(failure);
        await scope.assert.rejects(async function () {
            return await fixture.service.acquire({ ...fixture.context, signal: controller.signal });
        }, {
            exact: failure
        });
        scope.assert.deepEqual(fixture.calls, []);
        return scope.assert.collect();
    }),
    test('reports retained handler errors after releasing the service', async function (scope: TestScope) {
        const failure = new Error('Handler failed.');
        const fixture = simulatedHttpResource([ failure ]);
        const handle = await fixture.service.acquire(fixture.context);
        scope.require.defined(fixture.service.dispose);
        await scope.assert.rejects(async function () {
            return fixture.service.dispose?.(handle, fixture.context);
        }, { exact: failure });
        scope.assert.deepEqual(fixture.calls, [ 'listen:127.0.0.1:0', 'close' ]);
        return scope.assert.collect();
    })
]);

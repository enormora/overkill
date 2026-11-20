import { type TestNode, suite, test, testDouble } from '@overkill-dev/test';

import { executionHost } from '../test-support/execution-host.ts';
import { serveExecutionSessionHost } from './execution-session-host.ts';

export const testNode: TestNode = suite('execution host request and reply ownership', [
    test('initializes a frozen invocation and sends checkpoints before the result', async function (scope) {
        const fixture = await executionHost('none');
        await serveExecutionSessionHost(fixture.runtime);
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.initialized, [ {
            environment: 'profile-default',
            command: { kind: 'frozen-policy', invocation: { seed: { value: 42n }, selection: { kind: 'all' } } }
        } ]);
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.messages, [ {
            kind: 'execution-checkpoint',
            data: { progress: 1 }
        }, { kind: 'result', data: { value: 42 } } ]);
        scope.assert.deepEqual(fixture.events, [ 'execute', 'send', 'send', 'disconnect' ]);
        return scope.assert.collect();
    }),
    test('rejects malformed host requests before creating an environment', async function (scope) {
        const fixture = await executionHost('request');
        await scope.assert.rejects(async function () {
            await serveExecutionSessionHost(fixture.runtime);
        }, { name: 'ZodError' });
        scope.assert.deepEqual(fixture.initialized, []);
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    }),
    test('wraps non-Error request transport failures', async function (scope) {
        const fixture = await executionHost('none');
        await scope.assert.rejects(async function () {
            await serveExecutionSessionHost({ ...fixture.runtime, receive: testDouble.rejects('disconnected') });
        }, { message: 'Invalid execution host request.', cause: { exact: 'disconnected' } });
        scope.assert.deepEqual(fixture.events, []);
        return scope.assert.collect();
    }),
    test('preserves checkpoint delivery failures and sends no final reply', async function (scope) {
        const fixture = await executionHost('checkpoint');
        await scope.assert.rejects(async function () {
            await serveExecutionSessionHost(fixture.runtime);
        }, { exact: fixture.failure });
        scope.assert.deepEqual(fixture.events, [ 'execute', 'send' ]);
        return scope.assert.collect();
    }),
    test('preserves environment failures after checkpoints', async function (scope) {
        const fixture = await executionHost('execute');
        await scope.assert.rejects(async function () {
            await serveExecutionSessionHost(fixture.runtime);
        }, { exact: fixture.failure });
        scope.assert.deepEqual(fixture.events, [ 'execute', 'send' ]);
        return scope.assert.collect();
    }),
    test('does not disconnect before a failed final reply is delivered', async function (scope) {
        const fixture = await executionHost('reply');
        await scope.assert.rejects(async function () {
            await serveExecutionSessionHost(fixture.runtime);
        }, { exact: fixture.failure });
        scope.assert.deepEqual(fixture.events, [ 'execute', 'send', 'send' ]);
        return scope.assert.collect();
    })
]);

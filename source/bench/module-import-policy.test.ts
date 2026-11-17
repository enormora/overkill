import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { moduleImportChannel, importChannelScenario } from '../test-support/module-import-channel.ts';

export const testNode = suite('module import channel policy', [
    test('authenticates readiness and retains import metadata', async (scope: TestScope) => {
        const fixture = await moduleImportChannel(scope, importChannelScenario);
        fixture.session.start();
        fixture.deliver({ kind: 'ready', token: 'unit-import-token' });
        fixture.deliver(fixture.report);
        scope.assert.deepEqual(await fixture.session.report(), fixture.report);
        scope.assert.deepEqual(fixture.sent, [ 'import\n' ]);
        scope.assert.deepEqual(
            { startup: fixture.session.startupMilliseconds(), arguments: fixture.session.arguments },
            { startup: 1, arguments: [ '4321', 'unit-import-token' ] }
        );
        await fixture.session.close();
        scope.assert.deepEqual(fixture.events, [ '127.0.0.1', 'close' ]);
        return scope.assert.collect();
    }),
    test('releases pending reports when the owner closes', async function (scope: TestScope) {
        const fixture = await moduleImportChannel(scope, importChannelScenario);
        const failed = scope.assert.rejects(async function () {
            return fixture.session.report();
        }, {
            message: 'Module import session closed before reporting.'
        });
        await fixture.session.close();
        await failed;
        return scope.assert.collect();
    }),
    test('rejects replies authenticated for another owner', async function (scope: TestScope) {
        const fixture = await moduleImportChannel(scope, importChannelScenario);
        fixture.deliver({ kind: 'ready', token: 'wrong' });
        await scope.assert.rejects(async function () {
            return fixture.session.report();
        }, {
            message: 'Invalid module import identity or duplicate reply.'
        });
        await fixture.session.close();
        return scope.assert.collect();
    }),
    test('rejects completion before readiness', async function (scope: TestScope) {
        const fixture = await moduleImportChannel(scope, importChannelScenario);
        fixture.deliver(fixture.report);
        await scope.assert.rejects(async function () {
            return fixture.session.report();
        }, {
            message: 'Module import completed before readiness.'
        });
        await fixture.session.close();
        return scope.assert.collect();
    }),
    test('rejects a second readiness command', async function (scope: TestScope) {
        const fixture = await moduleImportChannel(scope, importChannelScenario);
        fixture.deliver({ kind: 'ready', token: 'unit-import-token' });
        fixture.deliver({ kind: 'ready', token: 'unit-import-token' });
        await scope.assert.rejects(async function () {
            return fixture.session.report();
        }, {
            message: 'Module import became ready more than once.'
        });
        await fixture.session.close();
        return scope.assert.collect();
    }),
    test('fails malformed and oversized frames before admission', async function (scope: TestScope) {
        const malformed = await moduleImportChannel(scope, importChannelScenario);
        malformed.socket.push('not JSON\n');
        await scope.assert.rejects(async function () {
            return malformed.session.report();
        }, { name: 'SyntaxError' });
        await malformed.session.close();
        const oversized = await moduleImportChannel(scope, importChannelScenario);
        oversized.socket.push('x'.repeat(65_537));
        await scope.assert.rejects(async function () {
            return oversized.session.report();
        }, {
            message: 'Module import message exceeded its frame limit.'
        });
        await oversized.session.close();
        return scope.assert.collect();
    }),
    test('propagates transport failures to report owners', async function (scope: TestScope) {
        const fixture = await moduleImportChannel(scope, importChannelScenario);
        const failure = new Error('Socket failed.');
        fixture.socket.emit('error', failure);
        await scope.assert.rejects(async function () {
            return fixture.session.report();
        }, { exact: failure });
        await fixture.session.close();
        return scope.assert.collect();
    }),
    test('propagates listener startup and shutdown errors', async function (scope: TestScope) {
        const failure = new Error('Listen failed.');
        await scope.assert.rejects(
            async function () {
                return moduleImportChannel(scope, { ...importChannelScenario, listenError: failure });
            },
            { exact: failure }
        );
        await scope.assert.rejects(async function () {
            return moduleImportChannel(scope, { ...importChannelScenario, address: null });
        }, {
            message: 'Module import requires a local socket.'
        });
        const closing = new Error('Close failed.');
        const fixture = await moduleImportChannel(scope, { ...importChannelScenario, closeError: closing });
        await scope.assert.rejects(async function () {
            return fixture.session.close();
        }, { exact: closing });
        return scope.assert.collect();
    })
]);

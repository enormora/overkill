import { once } from 'node:events';
import { connect, type Socket } from 'node:net';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createModuleImportSession, type ModuleImportSession } from './module-import-session.ts';
import { withinProcessDeadline } from './process-deadline.ts';

type ModulePeer = { readonly session: ModuleImportSession; readonly socket: Socket; readonly token: string; };
type InvalidFrame = {
    readonly title: string;
    readonly frame: (token: string) => string;
    readonly message: string;
};

async function modulePeer(scope: TestScope): Promise<ModulePeer> {
    const session = await createModuleImportSession();
    scope.cleanup(session.close);
    session.start();
    const socket = connect({ host: '127.0.0.1', port: Number(session.arguments[0]) });
    scope.cleanup(function closePeer() {
        socket.destroy();
    });
    socket.on('error', function closeRejectedPeer() {
        socket.destroy();
    });
    await once(socket, 'connect');
    return { session, socket, token: String(session.arguments[1]) };
}
function importedMessage(token: string): Readonly<Record<string, unknown>> {
    return {
        kind: 'imported',
        token,
        url: 'file:///fixture.mjs',
        durationMicroseconds: 7,
        failure: null,
        nodeVersion: process.versions.node,
        nodeArguments: []
    };
}
const invalidFrames: readonly InvalidFrame[] = [
    {
        title: 'rejects replies from a different import owner',
        frame() {
            return JSON.stringify({ kind: 'ready', token: 'wrong-owner' });
        },
        message: 'Invalid module import identity or duplicate reply.'
    },
    {
        title: 'rejects completion before the import command',
        frame(token) {
            return JSON.stringify(importedMessage(token));
        },
        message: 'Module import completed before readiness.'
    }
];

export const testNode = suite('module import control protocol', [
    test('releases a pending report when its owner closes', async function (scope: TestScope) {
        const session = await createModuleImportSession();
        await using disposal = new AsyncDisposableStack();
        disposal.defer(session.close);
        const pending = withinProcessDeadline(session.report(), 1000, 'Report remained pending after closing.');
        const checked = scope.assert.rejects(async function closedReport() {
            return await pending;
        }, { message: 'Module import session closed before reporting.' });
        await disposal.disposeAsync();
        await checked;
        return scope.assert.collect();
    }),
    test('starts import only after readiness and returns authenticated metadata', async function (scope: TestScope) {
        const peer = await modulePeer(scope);
        peer.socket.write(`${JSON.stringify({ kind: 'ready', token: peer.token })}\n`);
        const commandEvent = await once(peer.socket, 'data');
        const command: unknown = commandEvent[0];
        scope.assert.equal(String(command), 'import\n');
        peer.socket.end(`${JSON.stringify(importedMessage(peer.token))}\n`);
        const report = await peer.session.report();
        scope.assert.partialDeepEqual(report, { url: 'file:///fixture.mjs', durationMicroseconds: 7, failure: null });
        scope.assert.true(peer.session.startupMilliseconds() >= 0);
        return scope.assert.collect();
    }),
    ...invalidFrames.map(function rejectedFrame(frame) {
        return test(frame.title, async function (scope: TestScope) {
            const peer = await modulePeer(scope);
            peer.socket.end(`${frame.frame(peer.token)}\n`);
            await scope.assert.rejects(async function rejectedReport() {
                return await peer.session.report();
            }, { message: frame.message });
            return scope.assert.collect();
        });
    }),
    test('rejects a second readiness command', async function (scope: TestScope) {
        const peer = await modulePeer(scope);
        const message = `${JSON.stringify({ kind: 'ready', token: peer.token })}\n`;
        peer.socket.write(message);
        await once(peer.socket, 'data');
        peer.socket.end(message);
        await scope.assert.rejects(async function rejectedReport() {
            return await peer.session.report();
        }, { message: 'Module import became ready more than once.' });
        return scope.assert.collect();
    }),
    test('rejects malformed JSON without an unhandled owner rejection', async function (scope: TestScope) {
        const peer = await modulePeer(scope);
        peer.socket.end('not-json\n');
        await scope.assert.rejects(async function rejectedReport() {
            return await peer.session.report();
        }, { type: SyntaxError });
        return scope.assert.collect();
    }),
    test('bounds a frame before JSON parsing', async function (scope: TestScope) {
        const peer = await modulePeer(scope);
        peer.socket.end('x'.repeat(65_537));
        await scope.assert.rejects(async function rejectedReport() {
            return await peer.session.report();
        }, { message: 'Module import message exceeded its frame limit.' });
        return scope.assert.collect();
    })
]);

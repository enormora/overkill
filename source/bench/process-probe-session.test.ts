import { once } from 'node:events';
import { connect, type Socket } from 'node:net';
import { writeFile } from 'node:fs/promises';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createProcessProbe, type ProcessProbe } from './process-probe-session.ts';
import { unavailableChildMetrics, nodeProbeMaximumReportBytes, type NodeProbeReport } from './process-node-readings.ts';

type ProbePeer = {
    readonly probe: ProcessProbe;
    readonly socket: Socket;
    readonly token: string;
    readonly reportPath: string;
    readonly exited: Promise<void>;
};
type RejectedIdentity = { readonly title: string; readonly token: (valid: string) => string; readonly pid: number; };

function probeReport(): NodeProbeReport {
    return {
        version: 1,
        runtime: process.version,
        observationMicroseconds: 7,
        metrics: unavailableChildMetrics('fixture report')
    };
}

async function probePeer(scope: TestScope): Promise<ProbePeer> {
    const probe = await createProcessProbe();
    scope.cleanup(probe.dispose);
    const exited = Promise.withResolvers<undefined>();
    scope.cleanup(function finishProbeChild() {
        exited.resolve(undefined);
    });
    probe.identify(process.pid);
    const socket = connect({ host: '127.0.0.1', port: Number(probe.environment.OVERKILL_BENCH_PROBE_PORT) });
    scope.cleanup(function closePeer() {
        socket.destroy();
    });
    socket.on('error', function closeRejectedPeer() {
        socket.destroy();
    });
    await once(socket, 'connect');
    return {
        probe,
        socket,
        token: String(probe.environment.OVERKILL_BENCH_PROBE_TOKEN),
        reportPath: String(probe.environment.OVERKILL_BENCH_PROBE_REPORT),
        exited: exited.promise
    };
}

async function replyToSnapshot(peer: ProbePeer, report: NodeProbeReport): Promise<void> {
    const command = once(peer.socket, 'data');
    peer.socket.write(`${JSON.stringify({ token: peer.token, pid: process.pid })}\n`);
    const received = await command;
    const payload: unknown = received[0];
    if (String(payload) !== 'snapshot\n') {
        throw new Error('Expected a Node probe snapshot request.');
    }
    peer.socket.write(`${JSON.stringify(report)}\n`);
}

async function rejectActiveProbe(scope: TestScope, peer: ProbePeer, frame: string): Promise<void> {
    const checked = scope.assert.rejects(async function rejectedSnapshot() {
        return await peer.probe.checkpointSnapshot(peer.exited);
    }, { message: 'Node probe disconnected while its child remained active.' });
    peer.socket.write(frame);
    await checked;
}

const rejectedIdentities: readonly RejectedIdentity[] = [
    {
        title: 'rejects probe reports from another token',
        token() {
            return 'wrong-owner';
        },
        pid: process.pid
    },
    {
        title: 'rejects probe reports from another process',
        token(valid) {
            return valid;
        },
        pid: process.pid + 1
    }
];

export const testNode = suite('Node probe control protocol', [
    test('requests an authenticated snapshot and preserves its readings', async function (scope: TestScope) {
        const peer = await probePeer(scope);
        const report = probeReport();
        const response = replyToSnapshot(peer, report);
        const snapshot = await peer.probe.checkpointSnapshot(peer.exited);
        await response;
        scope.assert.deepEqual(snapshot, report);
        return scope.assert.collect();
    }),
    ...rejectedIdentities.map(function rejectedIdentity(identity) {
        return test(identity.title, async function (scope: TestScope) {
            const peer = await probePeer(scope);
            const frame = `${JSON.stringify({ token: identity.token(peer.token), pid: identity.pid })}\n` +
                `${JSON.stringify(probeReport())}\n`;
            await rejectActiveProbe(scope, peer, frame);
            return scope.assert.collect();
        });
    }),
    test('rejects malformed JSON without accepting a later report', async function (scope: TestScope) {
        const peer = await probePeer(scope);
        await rejectActiveProbe(scope, peer, `not-json\n${JSON.stringify(probeReport())}\n`);
        return scope.assert.collect();
    }),
    test('rejects malformed reports after a valid handshake', async function (scope: TestScope) {
        const peer = await probePeer(scope);
        const identity = JSON.stringify({ token: peer.token, pid: process.pid });
        await rejectActiveProbe(scope, peer, `${identity}\nnot-json\n`);
        return scope.assert.collect();
    }),
    test('bounds incoming frames before parsing them', async function (scope: TestScope) {
        const peer = await probePeer(scope);
        await rejectActiveProbe(scope, peer, 'x'.repeat(nodeProbeMaximumReportBytes + 1));
        return scope.assert.collect();
    }),
    test('reads the final report when an exited child loses its probe connection', async function (scope: TestScope) {
        const peer = await probePeer(scope);
        const report = probeReport();
        await writeFile(peer.reportPath, JSON.stringify(report));
        peer.socket.destroy();
        scope.assert.deepEqual(await peer.probe.checkpointSnapshot(Promise.resolve()), report);
        return scope.assert.collect();
    }),
    test('bounds the final report before parsing JSON', async function (scope: TestScope) {
        const peer = await probePeer(scope);
        await writeFile(peer.reportPath, 'x'.repeat(nodeProbeMaximumReportBytes + 1));
        await scope.assert.rejects(peer.probe.finalSnapshot, {
            message: 'Node probe exceeded the final report limit.'
        });
        return scope.assert.collect();
    }),
    test('removes final evidence and permits repeated disposal', async function (scope: TestScope) {
        const peer = await probePeer(scope);
        await writeFile(peer.reportPath, JSON.stringify(probeReport()));
        await peer.probe.dispose();
        await peer.probe.dispose();
        await scope.assert.rejects(peer.probe.finalSnapshot, { message: /ENOENT/u });
        return scope.assert.collect();
    })
]);

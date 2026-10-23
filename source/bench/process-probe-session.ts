import { Transform } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { createInterface } from 'node:readline';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { processNodeProbeEntryPointUrl } from '../packages/bench/process-node-probe.entry-point.ts';
import { createJsonFrameLimiter } from '../packages/resources/attachment-context.entry-point.ts';
import {
    nodeProbeIdentitySchema,
    nodeProbeMaximumReportBytes,
    nodeProbeReportSchema,
    type NodeProbeReport
} from './process-node-readings.ts';
import { withinProcessDeadline } from './process-deadline.ts';
import { prepareProbeReport, type ProcessProbeReportStorage } from './process-probe-report.ts';

export type ProcessProbe = {
    readonly environment: Readonly<Record<string, string>>;
    readonly arguments: readonly string[];
    readonly identify: (pid: number) => void;
    readonly checkpointSnapshot: (exited: Promise<unknown>) => Promise<NodeProbeReport>;
    readonly finalSnapshot: () => Promise<NodeProbeReport>;
    readonly dispose: () => Promise<void>;
};
type ProbeResult<Value> = { readonly success: false; readonly error: Error; } | {
    readonly success: true;
    readonly value: Value;
};
type ProbeSession = {
    readonly report: ProcessProbeReportStorage;
    readonly token: string;
    readonly server: Server;
    readonly connected: Readonly<PromiseWithResolvers<ProbeResult<Socket>>>;
    readonly reading: Readonly<PromiseWithResolvers<ProbeResult<NodeProbeReport>>>;
    readonly sockets: Readonly<Set<Socket>>;
    readonly identified: Readonly<Set<Socket>>;
    readonly owner: StoredValue<number | null>;
    readonly port: StoredValue<number>;
};
const probeSnapshotMilliseconds = 250;
const probeTokenBytes = 24;

async function probeResult<Value>(pending: Promise<ProbeResult<Value>>): Promise<Value> {
    const result = await pending;
    if (!result.success) {
        throw result.error;
    }
    return result.value;
}

function failProbeSession(session: ProbeSession, error: Error): void {
    session.connected.resolve({ success: false, error });
    session.reading.resolve({ success: false, error });
}

function failProbe(session: ProbeSession, socket: Socket, error: Error): void {
    failProbeSession(session, error);
    socket.destroy();
}

function probeMessage(session: ProbeSession, socket: Socket, value: unknown): void {
    if (session.identified.has(socket)) {
        session.reading.resolve({ success: true, value: nodeProbeReportSchema.parse(value) });
    } else {
        const identity = nodeProbeIdentitySchema.parse(value);
        if (identity.token !== session.token || identity.pid !== session.owner.read()) {
            throw new Error('Node probe identity mismatch.');
        }
        session.identified.add(socket);
        session.connected.resolve({ success: true, value: socket });
    }
}

function receiveProbe(session: ProbeSession, socket: Socket, line: string): void {
    try {
        probeMessage(session, socket, JSON.parse(line));
    } catch (error: unknown) {
        failProbe(session, socket, new Error('Invalid Node probe message.', { cause: error }));
    }
}

function acceptProbe(session: ProbeSession, socket: Socket): void {
    session.sockets.add(socket);
    const frames = new Transform({ transform: createJsonFrameLimiter(nodeProbeMaximumReportBytes, 'Node probe') });
    const lines = createInterface({ input: socket.pipe(frames) });
    frames.on('error', function (error: Error) {
        failProbe(session, socket, error);
    });
    socket.on('error', function (error: Error) {
        failProbe(session, socket, error);
    });
    lines.on('error', function (error: Error) {
        failProbe(session, socket, error);
    });
    lines.on('line', function (line) {
        receiveProbe(session, socket, line);
    });
    socket.on('close', function () {
        lines.close();
        frames.destroy();
        session.sockets.delete(socket);
        session.identified.delete(socket);
        failProbe(session, socket, new Error('Node probe disconnected.'));
    });
}

async function listenForProbe(session: ProbeSession): Promise<void> {
    await new Promise<void>(function (resolve, reject) {
        session.server.once('error', reject);
        session.server.listen(0, '127.0.0.1', resolve);
    });
    const address = session.server.address();
    if (address === null || typeof address === 'string') {
        throw new Error('Node probe requires a loopback endpoint.');
    }
    session.port.write(address.port);
}

async function requestProbeSnapshot(session: ProbeSession): Promise<NodeProbeReport> {
    const socket = await probeResult(session.connected.promise);
    socket.write('snapshot\n');
    return await probeResult(session.reading.promise);
}

async function closeProbeServer(session: ProbeSession): Promise<void> {
    if (!session.server.listening) {
        return;
    }
    await new Promise<void>(function (resolve, reject) {
        session.server.close(function probeServerClosed(error) {
            if (error === undefined) {
                resolve();
            } else {
                reject(error);
            }
        });
    });
}

async function disposeProbe(session: ProbeSession): Promise<void> {
    failProbeSession(session, new Error('Node probe disposed.'));
    for (const socket of session.sockets) {
        socket.destroy();
    }
    try {
        await closeProbeServer(session);
    } finally {
        await session.report.dispose();
    }
}

function probeSession(report: ProcessProbeReportStorage): ProbeSession {
    const session: ProbeSession = {
        report,
        token: randomBytes(probeTokenBytes).toString('hex'),
        server: createServer(),
        connected: Promise.withResolvers<ProbeResult<Socket>>(),
        reading: Promise.withResolvers<ProbeResult<NodeProbeReport>>(),
        sockets: new Set(),
        identified: new Set(),
        owner: createStoredValue<number | null>(null),
        port: createStoredValue(0)
    };
    session.server.on('connection', function (socket) {
        acceptProbe(session, socket);
    });
    return session;
}

async function checkpointProbeReport(session: ProbeSession, exited: Promise<unknown>): Promise<NodeProbeReport> {
    try {
        return await withinProcessDeadline(
            requestProbeSnapshot(session),
            probeSnapshotMilliseconds,
            'Node probe snapshot exceeded 250 milliseconds.'
        );
    } catch {
        await withinProcessDeadline(
            exited,
            probeSnapshotMilliseconds,
            'Node probe disconnected while its child remained active.'
        );
        return await session.report.read();
    }
}

function processProbe(session: ProbeSession): ProcessProbe {
    return {
        arguments: [ '--import', processNodeProbeEntryPointUrl.href ],
        environment: {
            OVERKILL_BENCH_PROBE_PORT: String(session.port.read()),
            OVERKILL_BENCH_PROBE_TOKEN: session.token,
            OVERKILL_BENCH_PROBE_REPORT: session.report.path
        },
        identify(pid) {
            session.owner.write(pid);
        },
        async finalSnapshot() {
            return await session.report.read();
        },
        async checkpointSnapshot(exited) {
            return await checkpointProbeReport(session, exited);
        },
        async dispose() {
            await disposeProbe(session);
        }
    };
}

export async function createProcessProbe(): Promise<ProcessProbe> {
    const session = probeSession(await prepareProbeReport());
    try {
        await listenForProbe(session);
        return processProbe(session);
    } catch (error: unknown) {
        await disposeProbe(session);
        throw error;
    }
}

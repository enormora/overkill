import { writeFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { isMainThread } from 'node:worker_threads';
import { observeNodeChild, type NodeChildObservation } from '../../bench/process-node-observation.ts';

export const processNodeProbeEntryPointUrl = new URL(import.meta.url);
const maximumRequestBytes = 32;

function observeSnapshotRequests(socket: Socket, observation: NodeChildObservation): void {
    let request = '';
    socket.on('data', function snapshotRequested(chunk: Buffer) {
        request += chunk.toString();
        if (request === 'snapshot\n') {
            socket.write(`${JSON.stringify(observation.snapshot())}\n`);
            request = '';
        } else if (request.length > maximumRequestBytes) {
            socket.destroy();
        }
    });
}

function childRuntimeProbe(port: number, token: string, reportPath: string): void {
    const observation = observeNodeChild();
    const socket = connect({ host: '127.0.0.1', port });
    socket.unref();
    socket.on('error', function disconnectedObserver() {
        socket.destroy();
    });
    socket.on('connect', function identifyProbe() {
        socket.write(`${JSON.stringify({ token, pid: process.pid })}\n`);
    });
    observeSnapshotRequests(socket, observation);
    process.once('exit', function retainFinalSnapshot() {
        // eslint-disable-next-line node/no-sync -- Exit listeners cannot await the final telemetry write.
        writeFileSync(reportPath, JSON.stringify(observation.snapshot()), { mode: 0o600 });
        observation.dispose();
    });
}

const endpoint = process.env.OVERKILL_BENCH_PROBE_PORT;
const token = process.env.OVERKILL_BENCH_PROBE_TOKEN;
const reportPath = process.env.OVERKILL_BENCH_PROBE_REPORT;
if (isMainThread && endpoint !== undefined && token !== undefined && reportPath !== undefined) {
    delete process.env.OVERKILL_BENCH_PROBE_PORT;
    delete process.env.OVERKILL_BENCH_PROBE_TOKEN;
    delete process.env.OVERKILL_BENCH_PROBE_REPORT;
    childRuntimeProbe(Number(endpoint), token, reportPath);
}

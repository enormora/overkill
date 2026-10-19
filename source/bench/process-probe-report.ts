import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeProbeMaximumReportBytes, nodeProbeReportSchema, type NodeProbeReport } from './process-node-readings.ts';

export type ProcessProbeReportStorage = {
    readonly path: string;
    readonly read: () => Promise<NodeProbeReport>;
    readonly dispose: () => Promise<void>;
};

async function boundedReportBytes(file: Readonly<FileHandle>): Promise<Buffer> {
    const buffer = Buffer.alloc(nodeProbeMaximumReportBytes + 1);
    let length = 0;
    while (length < buffer.length) {
        const read = await file.read(buffer, length, buffer.length - length, null);
        if (read.bytesRead === 0) {
            break;
        }
        length += read.bytesRead;
    }
    if (length > nodeProbeMaximumReportBytes) {
        throw new Error('Node probe exceeded the final report limit.');
    }
    return buffer.subarray(0, length);
}

async function readFinalProbeReport(path: string): Promise<NodeProbeReport> {
    await using file = await open(path, 'r');
    const bytes = await boundedReportBytes(file);
    return nodeProbeReportSchema.parse(JSON.parse(bytes.toString()));
}

export async function prepareProbeReport(): Promise<ProcessProbeReportStorage> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-probe-'));
    const path = join(directory, 'report.json');
    return {
        path,
        async read() {
            return await readFinalProbeReport(path);
        },
        async dispose() {
            await rm(directory, { recursive: true, force: true });
        }
    };
}

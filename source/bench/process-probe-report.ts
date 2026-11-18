import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeProbeMaximumReportBytes, nodeProbeReportSchema, type NodeProbeReport } from './process-node-readings.ts';

export type ProcessProbeReportStorage = {
    readonly path: string;
    readonly read: () => Promise<NodeProbeReport>;
    readonly dispose: () => Promise<void>;
};

type ProbeReadResult = { readonly bytesRead: number; };
type ProbeReportFile = AsyncDisposable & {
    readonly read: (buffer: Uint8Array, offset: number, length: number, position: null) => Promise<ProbeReadResult>;
};
export type ProbeReportRuntime = {
    readonly directory: () => Promise<string>;
    readonly open: (path: string) => Promise<ProbeReportFile>;
    readonly remove: (directory: string) => Promise<void>;
};
export function createProbeReportStorage(runtime: ProbeReportRuntime): () => Promise<ProcessProbeReportStorage> {
    async function boundedReportBytes(file: ProbeReportFile): Promise<Buffer> {
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
        await using file = await runtime.open(path);
        const bytes = await boundedReportBytes(file);
        return nodeProbeReportSchema.parse(JSON.parse(bytes.toString()));
    }

    return async function prepareProbeReport(): Promise<ProcessProbeReportStorage> {
        const directory = await runtime.directory();
        const path = join(directory, 'report.json');
        return {
            path,
            async read() {
                return await readFinalProbeReport(path);
            },
            async dispose() {
                await runtime.remove(directory);
            }
        };
    };
}
export const prepareProbeReport = createProbeReportStorage({
    async directory() {
        return await mkdtemp(join(tmpdir(), 'overkill-probe-'));
    },
    async open(path) {
        return await open(path, 'r');
    },
    async remove(directory) {
        await rm(directory, { recursive: true, force: true });
    }
});

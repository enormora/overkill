import { createProbeReportStorage, type ProcessProbeReportStorage } from '../bench/process-probe-report.ts';
import {
    unavailableChildMetrics,
    nodeProbeMaximumReportBytes,
    type NodeProbeReport
} from '../bench/process-node-readings.ts';

export const processProbeReport: NodeProbeReport = {
    version: 1,
    runtime: 'test',
    observationMicroseconds: 0,
    metrics: unavailableChildMetrics('unit fixture')
};
export type ProbeReportScenario = 'invalid-json' | 'invalid-report' | 'oversized' | 'pass' | 'read-error';
type ProbeReadResult = { readonly bytesRead: number; };
type ProbeReportFixture = {
    readonly prepare: () => Promise<ProcessProbeReportStorage>;
    readonly calls: readonly string[];
    readonly failure: Error;
};
function reportBytes(scenario: ProbeReportScenario): Buffer {
    if (scenario === 'oversized') {
        return Buffer.alloc(nodeProbeMaximumReportBytes + 1);
    }
    if (scenario === 'invalid-json') {
        return Buffer.from('invalid');
    }
    return Buffer.from(JSON.stringify(scenario === 'invalid-report' ? {} : processProbeReport));
}
const maximumChunkBytes = 100;
export function processProbeReportStorage(scenario: ProbeReportScenario): ProbeReportFixture {
    const calls: string[] = [];
    const failure = new Error('Read failed.');
    const bytes = reportBytes(scenario);
    let position = 0;
    const prepare = createProbeReportStorage({
        async directory() {
            calls.push('directory');
            return '/reports';
        },
        async open(path) {
            calls.push(`open:${path}`);
            const lifetime = new AsyncDisposableStack();
            lifetime.defer(async function () {
                calls.push('close');
            });
            return Object.assign(lifetime, {
                async read(buffer: Uint8Array, offset: number, length: number): Promise<ProbeReadResult> {
                    if (scenario === 'read-error') {
                        throw failure;
                    }
                    const bytesRead = Math.min(maximumChunkBytes, length, bytes.length - position);
                    buffer.set(bytes.subarray(position, position + bytesRead), offset);
                    position += bytesRead;
                    return { bytesRead };
                }
            });
        },
        async remove(path) {
            calls.push(`remove:${path}`);
        }
    });
    return { prepare, calls, failure };
}

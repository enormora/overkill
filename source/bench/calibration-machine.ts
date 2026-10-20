import { createHash } from 'node:crypto';
import os from 'node:os';

const machineClassDigestLength = 16;
type HostMetadata = {
    readonly architecture: string;
    readonly availableParallelism: number;
    readonly cpuCount: number;
    readonly cpuModels: readonly string[];
    readonly freeMemoryBytes: number;
    readonly loadAverage: readonly number[];
    readonly nodeArguments: readonly string[];
    readonly nodeVersion: string;
    readonly operatingSystem: string;
    readonly operatingSystemRelease: string;
    readonly totalMemoryBytes: number;
};
export function readCalibrationHostMetadata(nodeArguments: readonly string[]): HostMetadata {
    const cpus = os.cpus();
    return {
        architecture: process.arch,
        availableParallelism: os.availableParallelism(),
        cpuCount: cpus.length,
        cpuModels: Array
            .from(
                new Set(cpus.map(function cpuModel(cpu) {
                    return cpu.model;
                }))
            )
            .toSorted(function alphabetical(left, right) {
                return left.localeCompare(right);
            }),
        freeMemoryBytes: os.freemem(),
        loadAverage: os.loadavg(),
        nodeArguments: Array.from(nodeArguments),
        nodeVersion: process.versions.node,
        operatingSystem: process.platform,
        operatingSystemRelease: os.release(),
        totalMemoryBytes: os.totalmem()
    };
}

export function calibrationMachineClass(metadata: HostMetadata): string {
    const classification = JSON.stringify({
        architecture: metadata.architecture,
        cpuCount: metadata.cpuCount,
        cpuModels: metadata.cpuModels.map(function (model) {
            return model.normalize('NFC');
        }),
        nodeArguments: metadata.nodeArguments.map(function (argument) {
            return argument.normalize('NFC');
        }),
        nodeMajor: metadata.nodeVersion.split('.', 1)[0],
        operatingSystem: metadata.operatingSystem,
        totalMemoryBytes: metadata.totalMemoryBytes
    });
    const digest = createHash('sha256').update(classification).digest('hex').slice(0, machineClassDigestLength);
    return `${metadata.operatingSystem}-${metadata.architecture}-${digest}`;
}

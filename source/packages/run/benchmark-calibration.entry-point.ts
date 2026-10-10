import { createHash } from 'node:crypto';
import os from 'node:os';
import type { JsonValue, ReadonlyDeep } from 'type-fest';
import { z } from 'zod/v4';

export type ComparableCalibration = {
    readonly context: ReadonlyDeep<JsonValue>;
    readonly kind: 'comparable';
    readonly machineClass: string;
    readonly metadata: ReadonlyDeep<JsonValue>;
};
type NonComparableCalibration = {
    readonly kind: 'non-comparable';
    readonly metadata: ReadonlyDeep<JsonValue>;
    readonly reason: string;
};
export type BenchmarkCalibrationResult = ComparableCalibration | NonComparableCalibration;

const iterations = 2_000_000;
const sampleCount = 7;
const referenceWorkload = 'integer-mix-v1';
const multiplier = 1_664_525;
const increment = 1_013_904_223;
const integerRange = 4_294_967_296;
const nanosecondsPerMicrosecond = 1000;
const machineClassDigestLength = 16;
const medianDivisor = 2;
const referenceContextSchema = z
    .strictObject({
        checksum: z.number().int().nonnegative(),
        iterations: z.literal(iterations),
        medianMicroseconds: z.number().positive(),
        samplesMicroseconds: z.array(z.number().positive()).length(sampleCount),
        workload: z.literal(referenceWorkload)
    })
    .readonly();
type ReferenceCalibration = z.infer<typeof referenceContextSchema>;
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
type DurationNormalizationInput = {
    readonly actualCalibration: ComparableCalibration;
    readonly baselineCalibration: ComparableCalibration;
    readonly durationMicroseconds: number;
};

function referenceChecksum(): number {
    let checksum = 1;
    for (let index = 0; index < iterations; index += 1) {
        checksum = Math.abs(Math.imul(checksum + index, multiplier) + increment) % integerRange;
    }
    return checksum;
}

function hostMetadata(): HostMetadata {
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
        nodeArguments: Array.from(process.execArgv),
        nodeVersion: process.versions.node,
        operatingSystem: process.platform,
        operatingSystemRelease: os.release(),
        totalMemoryBytes: os.totalmem()
    };
}

function machineClass(metadata: HostMetadata): string {
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

function calibrationSamples(expectedChecksum: number): readonly number[] | null {
    referenceChecksum();
    const samples: number[] = [];
    for (let index = 0; index < sampleCount; index += 1) {
        const startedAt = process.hrtime.bigint();
        const checksum = referenceChecksum();
        const elapsedMicroseconds = Number(process.hrtime.bigint() - startedAt) / nanosecondsPerMicrosecond;
        if (checksum !== expectedChecksum || !Number.isFinite(elapsedMicroseconds) || elapsedMicroseconds <= 0) {
            return null;
        }
        samples.push(elapsedMicroseconds);
    }
    return samples;
}

function referenceCalibration(): ReferenceCalibration | null {
    const expectedChecksum = referenceChecksum();
    const samples = calibrationSamples(expectedChecksum);
    if (samples === null) {
        return null;
    }
    const sorted = samples.toSorted(function byDuration(left, right) {
        return left - right;
    });
    const medianMicroseconds = sorted[Math.floor(sampleCount / medianDivisor)];
    return medianMicroseconds === undefined ? null : {
        checksum: expectedChecksum,
        iterations,
        medianMicroseconds,
        samplesMicroseconds: Array.from(samples),
        workload: referenceWorkload
    };
}

export function calibrateBenchmarkHost(): BenchmarkCalibrationResult {
    const metadata = hostMetadata();
    if (metadata.cpuModels.length === 0) {
        return {
            kind: 'non-comparable',
            metadata,
            reason: 'CPU metadata is unavailable for machine-class attribution.'
        };
    }
    const context = referenceCalibration();
    return context === null
        ? { kind: 'non-comparable', metadata, reason: 'CPU reference calibration did not produce valid samples.' }
        : { context, kind: 'comparable', machineClass: machineClass(metadata), metadata };
}

export function normalizeBenchmarkDuration(input: DurationNormalizationInput): number {
    if (!Number.isFinite(input.durationMicroseconds) || input.durationMicroseconds < 0) {
        throw new TypeError('Benchmark duration must be a finite, nonnegative number.');
    }
    if (input.actualCalibration.machineClass !== input.baselineCalibration.machineClass) {
        throw new TypeError('Benchmark durations cannot be normalized across machine classes.');
    }
    const actual = referenceContextSchema.parse(input.actualCalibration.context);
    const baseline = referenceContextSchema.parse(input.baselineCalibration.context);
    const normalized = input.durationMicroseconds * (baseline.medianMicroseconds / actual.medianMicroseconds);
    if (!Number.isFinite(normalized)) {
        throw new TypeError('Normalized benchmark duration is not finite.');
    }
    return normalized;
}

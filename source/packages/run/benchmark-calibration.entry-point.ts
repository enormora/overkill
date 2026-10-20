import { z } from 'zod/v4';
import type { ComparableCalibration, BenchmarkCalibrationResult } from '../../bench/host-calibration-result.ts';
import { readCalibrationHostMetadata, calibrationMachineClass } from '../../bench/calibration-machine.ts';
import { referenceChecksum } from '../../bench/cpu-reference-workload.ts';

const iterations = 2_000_000;
const sampleCount = 7;
const referenceWorkload = 'integer-mix-v1';
const nanosecondsPerMicrosecond = 1000;
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
type DurationNormalizationInput = {
    readonly actualCalibration: ComparableCalibration;
    readonly baselineCalibration: ComparableCalibration;
    readonly durationMicroseconds: number;
};

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
    const metadata = readCalibrationHostMetadata(Array.from(process.execArgv));
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
        : { context, kind: 'comparable', machineClass: calibrationMachineClass(metadata), metadata };
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

export { referenceChecksum as runCpuCalibrationWorkload } from '../../bench/cpu-reference-workload.ts';
export { readCalibrationReferenceReport } from '../../bench/calibration-report.ts';
export type { CalibrationReferenceReport } from '../../bench/calibration-report.ts';

export type { ComparableCalibration, BenchmarkCalibrationResult } from '../../bench/host-calibration-result.ts';

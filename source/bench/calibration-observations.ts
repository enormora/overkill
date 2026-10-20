import type { MetricReading, CalibrationResult, CalibrationSnapshot } from '../engine/benchmark-result.ts';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import { normalizeBenchmarkMetrics } from './benchmark-observations.ts';
import { quantileInterval } from './benchmark-budget.ts';

type ReferenceDefinition = Pick<
    CalibrationSnapshot,
    'execution' | 'identity' | 'lifecycle' | 'machineClass' | 'metadata' | 'sampling'
>;
export type CalibrationObservations = {
    readonly samples: () => readonly number[];
    readonly observe: (returned: unknown) => void;
    readonly checkpoint: () => boolean;
    readonly result: () => CalibrationResult;
};
const medianProbability = 0.5;
const intervalSides = 2;
const checkpointGrowth = 2;
function referenceReading(
    returned: unknown,
    unit: string
): Extract<MetricReading, { readonly availability: 'available'; }> {
    const reading = normalizeBenchmarkMetrics(returned).reference;
    if (reading?.availability !== 'available' || reading.provenance.unit !== unit || reading.value <= 0) {
        throw new TypeError('Calibration must return an available, positive reading in its declared unit.');
    }
    return reading;
}
function preciseReference(samples: readonly number[], definition: ReferenceDefinition, checkpoint: number): boolean {
    const policy = definition.sampling;
    const delta = (1 - policy.confidenceLevel) / (checkpoint * (checkpoint + 1));
    const interval = quantileInterval(samples, medianProbability, delta);
    const tolerance = Math.max(
        Math.abs(interval.estimate) * policy.relativePrecision,
        policy.absolutePrecision.reference ?? 0
    );
    return interval.lower !== null && interval.upper !== null &&
        (interval.upper - interval.lower) / intervalSides <= tolerance;
}
export function createCalibrationObservations(definition: ReferenceDefinition): CalibrationObservations {
    const samples: number[] = [];
    let checkpoint = 0;
    let nextCheckpoint = definition.sampling.minimumSamples;
    let precise = false;
    let provenance: string | null = null;
    return {
        samples() {
            return Array.from(samples);
        },
        observe(returned) {
            const reading = referenceReading(returned, definition.identity.unit);
            const observed = canonicalIdentityJson(reading.provenance);
            if (provenance !== null && provenance !== observed) {
                throw new TypeError('Calibration changed its metric provenance between samples.');
            }
            provenance = observed;
            samples.push(reading.value);
        },
        checkpoint() {
            if (samples.length !== nextCheckpoint) {
                return false;
            }
            checkpoint += 1;
            precise = preciseReference(samples, definition, checkpoint);
            nextCheckpoint = Math.min(nextCheckpoint * checkpointGrowth, definition.sampling.maximumSamples);
            return precise;
        },
        result() {
            return precise
                ? {
                    kind: 'comparable',
                    snapshot: { ...definition, version: 1, checkpoint, samples: Array.from(samples) }
                }
                : {
                    kind: 'non-comparable',
                    reason: 'Calibration sampling limit reached before reference precision.',
                    samples: Array.from(samples)
                };
        }
    };
}

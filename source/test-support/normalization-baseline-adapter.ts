import { z } from 'zod/v4';
import { metricReadingSchema } from '../bench/benchmark-observations.ts';
import type {
    PerformanceBaselineAdapter,
    PerformanceObservationInput,
    PerformanceObservation
} from '../baselines/performance-adapter.ts';

const sampleSchema = z.object({ value: z.array(metricReadingSchema) });
function observedValue(input: PerformanceObservationInput): PerformanceObservation {
    const artifact = input.artifacts.find(function rawSamples(candidate) {
        return candidate.payload.kind === 'runtime-attachment' && candidate.payload.name === 'benchmark-samples';
    });
    if (artifact?.payload.kind !== 'runtime-attachment' || artifact.payload.content.kind !== 'json') {
        return { kind: 'missing', reason: 'Raw benchmark samples are unavailable.' };
    }
    const samples = sampleSchema.parse(artifact.payload.content.value);
    const first = samples.value.find(function available(reading) {
        return reading.availability === 'available';
    });
    return first?.availability === 'available'
        ? { kind: 'observed', value: first.value }
        : { kind: 'missing', reason: 'No available benchmark samples.' };
}
export function normalizationBaselineAdapter(id: string): PerformanceBaselineAdapter {
    return {
        id,
        observe: observedValue,
        propose(input) {
            return input.actual.value;
        },
        compare(input) {
            return input.actual.value === input.expected.value ? { kind: 'match' } : {
                kind: 'mismatch',
                diagnostics: [ {
                    actual: input.actual.value,
                    expected: input.expected.value,
                    summary: 'Raw benchmark value changed.'
                } ]
            };
        }
    };
}

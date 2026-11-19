import type { RawBenchmarkSample } from '../engine/measurement-evidence.ts';
import { readRawBenchmarkSamples } from '../packages/bench/bench.entry-point.ts';
import type {
    PerformanceBaselineAdapter,
    PerformanceObservationInput,
    PerformanceObservation
} from '../baselines/performance-adapter.ts';

function observedSampleValue(readings: readonly RawBenchmarkSample[]): PerformanceObservation {
    const first = readings
        .find(function available(entry) {
            return entry.reading.availability === 'available';
        })
        ?.reading;
    return first?.availability === 'available'
        ? { kind: 'observed', value: first.value }
        : { kind: 'missing', reason: 'No available benchmark samples.' };
}
function observedValue(input: PerformanceObservationInput): PerformanceObservation {
    const artifact = input.artifacts.find(function rawSamples(candidate) {
        return candidate.payload.kind === 'runtime-attachment' && candidate.payload.name === 'benchmark-samples';
    });
    if (artifact?.payload.kind !== 'runtime-attachment' || artifact.payload.content.kind !== 'json') {
        return { kind: 'missing', reason: 'Raw benchmark samples are unavailable.' };
    }
    const samples = readRawBenchmarkSamples(artifact.payload.content.value);
    return observedSampleValue(samples.metrics.value ?? []);
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

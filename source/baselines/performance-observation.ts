import { z } from 'zod/v4';
import type { BenchmarkNormalizationEvidence, MetricReading } from '../engine/benchmark-result.ts';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import type { RunArtifact } from '../engine/run-result.ts';
import { snapshotJson } from '../attachments/json-snapshot.ts';
import { metricReadingSchema } from '../bench/benchmark-statistics-schema.ts';
import type {
    PerformanceBaselineAdapter,
    PerformanceObservation,
    PerformanceObservationInput
} from './performance-adapter.ts';

const samplesSchema = z.record(z.string(), z.array(metricReadingSchema));
function scaledReading(reading: MetricReading, factor: number): MetricReading {
    if (reading.availability !== 'available') {
        return reading;
    }
    const value = reading.value * factor;
    if (!Number.isFinite(value)) {
        throw new TypeError('Normalized performance observation is not finite.');
    }
    return { ...reading, value };
}
function isSampleArtifact(artifact: RunArtifact): artifact is RuntimeAttachmentArtifact {
    return artifact.payload.kind === 'runtime-attachment' && artifact.payload.name === 'benchmark-samples';
}
function normalizedPerformanceArtifacts(
    artifacts: readonly RunArtifact[],
    normalization: BenchmarkNormalizationEvidence | null,
    maxBytes: number
): readonly RunArtifact[] {
    if (normalization === null) {
        return artifacts;
    }
    return artifacts.map(function normalizeSamples(artifact): RunArtifact {
        if (!isSampleArtifact(artifact) || artifact.payload.content.kind !== 'json') {
            return artifact;
        }
        const { payload } = artifact;
        const samples = samplesSchema.parse(artifact.payload.content.value);
        const value = Object.fromEntries(
            Object.entries(samples).map(function normalizeMetric([ name, readings ]) {
                const metric = Object.hasOwn(normalization.metrics, name) ? normalization.metrics[name] : undefined;
                const factor = metric === undefined
                    ? 1
                    : metric.budgetFactor;
                return [
                    name,
                    readings.map(function reading(observation) {
                        if (factor === null) {
                            throw new TypeError('Benchmark normalization is missing its budget scale.');
                        }
                        return scaledReading(observation, factor);
                    })
                ];
            })
        );
        const snapshot = snapshotJson(value, maxBytes);
        if (snapshot === null) {
            throw new Error('Normalized performance observation exceeds the configured artifact byte limit.');
        }
        return {
            ...artifact,
            payload: {
                ...payload,
                content: {
                    kind: 'json',
                    value: snapshot.value,
                    byteLength: Buffer.byteLength(snapshot.encoded)
                }
            }
        };
    });
}

export function observePerformance(
    adapter: PerformanceBaselineAdapter,
    input: PerformanceObservationInput,
    normalization: BenchmarkNormalizationEvidence | null,
    maxBytes: number
): PerformanceObservation {
    const observation = adapter.observe({
        ...input,
        artifacts: normalizedPerformanceArtifacts(input.artifacts, normalization, maxBytes)
    });
    if (observation.kind !== 'observed') {
        return observation;
    }
    const snapshot = snapshotJson(observation.value, maxBytes);
    if (snapshot === null) {
        throw new Error('Performance observation exceeds the configured artifact byte limit.');
    }
    return { ...observation, value: snapshot.value };
}

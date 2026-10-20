import { z } from 'zod/v4';
import type { RunArtifact, PerTestResult, RunResult } from '../engine/run-result.ts';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import { workIdentityKey } from '../engine/identity.ts';
import { metricReadingSchema } from './benchmark-statistics-schema.ts';

const samplesSchema = z.record(z.string(), z.array(metricReadingSchema));
type AvailableSamples = {
    readonly kind: 'available';
    readonly metrics: Readonly<Record<string, readonly number[]>>;
    readonly partial: boolean;
};
type UnavailableSamples = { readonly kind: 'unavailable'; readonly reason: string; };
export type BenchmarkSampleEvidence = AvailableSamples | UnavailableSamples;
function assertSampleAttempt(artifact: RunArtifact, test: PerTestResult): void {
    const attempt = test.attempts.at(-1)?.attempt;
    if (artifact.id.attempt === null || artifact.id.attempt.index !== attempt?.index) {
        throw new Error('Raw sample artifact belongs to another workload, runtime, case, or attempt.');
    }
}
function assertSampleOwner(artifact: RunArtifact, test: PerTestResult): void {
    const { id } = artifact;
    assertSampleAttempt(artifact, test);
    if (id.scope.kind !== 'case') {
        throw new Error('Raw sample artifact belongs to another workload, runtime, case, or attempt.');
    }
    const owner = { case: id.scope.case, workload: id.workload, runtimes: id.runtimes };
    if (workIdentityKey(owner) !== workIdentityKey(test.workId)) {
        throw new Error('Raw sample artifact belongs to another workload, runtime, case, or attempt.');
    }
}
function availableSamples(value: unknown, test: PerTestResult): Readonly<Record<string, readonly number[]>> {
    const parsed = samplesSchema.parse(value);
    const metrics = Object.fromEntries(
        Object.entries(parsed).map(function availableValues([ name, readings ]) {
            const provenance = test.benchmark?.metrics[name]?.provenance;
            for (const reading of readings) {
                if (
                    reading.availability === 'available' &&
                    canonicalIdentityJson(reading.provenance) !== canonicalIdentityJson(provenance)
                ) {
                    throw new Error(`Raw sample provenance differs from metric ${name}.`);
                }
            }
            return [
                name,
                readings.flatMap(function availableReading(reading) {
                    return reading.availability === 'available' ? [ reading.value ] : [];
                })
            ];
        })
    );
    return metrics;
}

type RetainedEvidence = { readonly kind: 'retained'; readonly reference: string; readonly partial: boolean; };
function retainedEvidence(test: PerTestResult): RetainedEvidence | UnavailableSamples {
    const evidence = test.benchmark?.rawSamples;
    if (evidence === undefined) {
        return { kind: 'unavailable', reason: 'No raw samples recorded.' };
    }
    if (evidence.status === 'omitted' || evidence.reference === null) {
        return { kind: 'unavailable', reason: evidence.reason ?? 'No raw samples recorded.' };
    }
    return { kind: 'retained', reference: evidence.reference, partial: evidence.status === 'truncated' };
}
function sampleContent(artifact: RunArtifact, test: PerTestResult, partial: boolean): BenchmarkSampleEvidence {
    const { payload } = artifact;
    if (payload.kind !== 'runtime-attachment' || payload.name !== 'benchmark-samples') {
        throw new Error('Raw sample reference does not identify benchmark samples.');
    }
    if (payload.content.kind !== 'json') {
        return { kind: 'unavailable', reason: 'Raw sample content is not retained as JSON.' };
    }
    return { kind: 'available', metrics: availableSamples(payload.content.value, test), partial };
}
function referencedSamples(
    result: RunResult,
    test: PerTestResult,
    evidence: RetainedEvidence
): BenchmarkSampleEvidence {
    const reference: unknown = JSON.parse(evidence.reference);
    const key = canonicalIdentityJson(reference);
    const artifact = result.artifacts.find(function referencedArtifact(candidate) {
        return canonicalIdentityJson(candidate.id) === key;
    });
    if (artifact === undefined) {
        return { kind: 'unavailable', reason: 'Referenced raw sample artifact is unavailable.' };
    }
    assertSampleOwner(artifact, test);
    return sampleContent(artifact, test, evidence.partial);
}
export function readBenchmarkSamples(result: RunResult, test: PerTestResult): BenchmarkSampleEvidence {
    const evidence = retainedEvidence(test);
    return evidence.kind === 'unavailable' ? evidence : referencedSamples(result, test, evidence);
}

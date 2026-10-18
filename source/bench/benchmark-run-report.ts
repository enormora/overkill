import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod/v4';
import type { RunResult } from '../engine/run-result.ts';
import { benchmarkCalibrationSchema } from './calibration-schema.ts';
import { benchmarkPlacementFactsSchema, benchmarkHostAssessmentSchema } from './benchmark-host-snapshot.ts';

const benchmarkRunMetadataVersion = 3;
const hostMetadataVersion = 2;

const legacyMetadataSchema = z.strictObject({
    version: z.literal(1),
    node: z.strictObject({ arch: z.string(), platform: z.string(), version: z.string() }),
    execution: z.strictObject({
        profile: z.string(),
        processModel: z.string(),
        scheduling: z.string(),
        maxConcurrency: z.union([ z.number(), z.literal('unlimited') ]),
        workerCount: z.number().nullable(),
        workerLifecycle: z.string().nullable()
    }),
    calibration: benchmarkCalibrationSchema.nullable()
});
const hostMetadataSchema = legacyMetadataSchema.extend({
    version: z.literal(hostMetadataVersion),
    host: benchmarkHostAssessmentSchema.nullable()
});
const metadataSchema = hostMetadataSchema.extend({
    version: z.literal(benchmarkRunMetadataVersion),
    placement: benchmarkPlacementFactsSchema.nullable()
});
export type BenchmarkRunMetadata = ReadonlyDeep<z.infer<typeof metadataSchema>>;
const recordedMetadataSchema = z.union([
    metadataSchema,
    hostMetadataSchema.transform(function historicalPlacement(value): BenchmarkRunMetadata {
        return { ...value, version: benchmarkRunMetadataVersion, placement: null };
    }),
    legacyMetadataSchema.transform(function legacyHostMetadata(value): BenchmarkRunMetadata {
        return { ...value, version: benchmarkRunMetadataVersion, host: null, placement: null };
    })
]);
export const benchmarkRunMediaType = 'application/vnd.overkill.benchmark-run+json';
export function readBenchmarkRunMetadata(result: RunResult): BenchmarkRunMetadata | null {
    for (const artifact of result.artifacts) {
        if (
            artifact.id.scope.kind === 'run' && artifact.payload.kind === 'runtime-attachment' &&
            artifact.payload.mediaType === benchmarkRunMediaType && artifact.payload.content.kind === 'json'
        ) {
            return recordedMetadataSchema.parse(artifact.payload.content.value);
        }
    }
    return null;
}

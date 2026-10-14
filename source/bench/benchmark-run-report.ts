import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod/v4';
import type { RunResult } from '../engine/run-result.ts';
import { benchmarkCalibrationSchema } from './calibration-schema.ts';

const metadataSchema = z.strictObject({
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
export type BenchmarkRunMetadata = ReadonlyDeep<z.infer<typeof metadataSchema>>;
export const benchmarkRunMediaType = 'application/vnd.overkill.benchmark-run+json';
export function readBenchmarkRunMetadata(result: RunResult): BenchmarkRunMetadata | null {
    for (const artifact of result.artifacts) {
        if (
            artifact.id.scope.kind === 'run' && artifact.payload.kind === 'runtime-attachment' &&
            artifact.payload.mediaType === benchmarkRunMediaType && artifact.payload.content.kind === 'json'
        ) {
            return metadataSchema.parse(artifact.payload.content.value);
        }
    }
    return null;
}

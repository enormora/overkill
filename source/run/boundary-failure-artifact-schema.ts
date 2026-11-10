import { z } from 'zod/v4';
import { boundaryUsageSampleLimit, type BoundaryFailureArtifact } from '../engine/run-artifact.ts';
import { attemptIdSchema, workIdSchema } from '../engine/identity-schema.ts';
import { runArtifactIdSchema } from './run-artifact-id-schema.ts';
import { processUsageSnapshotSchema } from './run-runtime-schema.ts';

const evidence = {
    timestamp: z.iso.datetime(),
    workerId: z.string().nullable(),
    nodeVersion: z.string().nullable(),
    activeWork: z.array(z.strictObject({ work: workIdSchema, attempt: attemptIdSchema })),
    capture: z.literal('automatic'),
    completeness: z.literal('best-effort')
};
const source = z.enum([ 'native', 'boundary-captured' ]);
export const boundaryFailureArtifactSchema: z.ZodType<BoundaryFailureArtifact> = z.union([
    z.strictObject({
        id: runArtifactIdSchema.and(z.object({ subtype: z.literal('worker-crash') })),
        source,
        payload: z.strictObject({
            ...evidence,
            kind: z.literal('worker-crash'),
            reason: z.string(),
            exitCode: z.number().int().nullable(),
            signal: z.string().nullable(),
            coreDumpPath: z.string().nullable(),
            nativeAddons: z.array(z.string()).nullable()
        })
    }),
    z.strictObject({
        id: runArtifactIdSchema.and(z.object({ subtype: z.literal('process-exhaustion') })),
        source,
        payload: z.strictObject({
            ...evidence,
            kind: z.literal('process-exhaustion'),
            metric: z.enum([
                'activeResourceCount',
                'javaScriptEngineHeapBytes',
                'residentSetBytes',
                'residentSetGrowthBytesPerSecond'
            ]),
            budget: z.number(),
            observed: z.number(),
            enforcement: z.enum([ 'post-test-diagnostic', 'sampled', 'v8-heap-limit' ]),
            processUsageSamplingIntervalMilliseconds: z.number().positive().nullable(),
            samples: z.array(processUsageSnapshotSchema).max(boundaryUsageSampleLimit)
        })
    })
]);

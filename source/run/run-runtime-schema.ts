import { z } from 'zod/v4';
import { resourceScopes, runTimingSpanKinds } from '../engine/run-timings.ts';

export const resourceUsageSnapshotSchema = z.strictObject({
    activeResourceCount: z.number(),
    activeResourceTypes: z.array(z.string()),
    capturedAtMicroseconds: z.number(),
    javaScriptEngineHeapBytes: z.number(),
    residentSetBytes: z.number()
});
export const resourceUsageSchema = z.strictObject({
    activeResourceTypes: z.array(z.string()),
    end: resourceUsageSnapshotSchema,
    peakActiveResourceCount: z.number(),
    peakJavaScriptEngineHeapBytes: z.number(),
    peakResidentSetBytes: z.number(),
    peakResidentSetGrowthBytesPerSecond: z.number(),
    sampleCount: z.number(),
    start: resourceUsageSnapshotSchema
});
export const runTimingSpanSchema = z.strictObject({
    durationMicroseconds: z.number(),
    kind: z.enum(runTimingSpanKinds),
    label: z.string().nullable(),
    processId: z.string().nullable(),
    resource: z.strictObject({ name: z.string(), scope: z.enum(resourceScopes) }).nullable(),
    startOffsetMicroseconds: z.number().nullable(),
    startTimeUnixMicroseconds: z.number(),
    status: z.enum([ 'cancelled', 'failure', 'success', 'timeout' ]),
    workerId: z.string().nullable()
});
export const runTimingsSchema = z.strictObject({
    summary: z.strictObject({
        runnerOverheadWallTimeMicroseconds: z.number(),
        testExecutionWallTimeMicroseconds: z.number(),
        totalWallTimeMicroseconds: z.number()
    }),
    precise: z
        .strictObject({
            aggregates: z.array(
                z.strictObject({
                    count: z.number(),
                    durationMicroseconds: z.number(),
                    kind: z.enum(runTimingSpanKinds)
                })
            ),
            ambientNoise: z.enum([ 'high', 'low', 'medium', 'unknown' ]),
            droppedSpanCount: z.number(),
            overhead: z.strictObject({
                aggregationMicroseconds: z.number(),
                recordingMicroseconds: z.number(),
                renderingMicroseconds: z.number(),
                serializationMicroseconds: z.number()
            }),
            observationWindow: z.strictObject({
                durationMicroseconds: z.number(),
                startTimeUnixMicroseconds: z.number()
            }),
            slowestSpans: z.array(runTimingSpanSchema),
            slowestSpanLimit: z.number(),
            spanLimit: z.number(),
            spans: z.array(runTimingSpanSchema),
            truncated: z.boolean()
        })
        .nullable()
});

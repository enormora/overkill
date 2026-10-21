import { z } from 'zod/v4';
import { maximumRetainedSamples } from '../engine/benchmark-limits.ts';

export const benchmarkTimelinePolicySchema = z.strictObject({
    maximumEvents: z.number().int().positive().max(maximumRetainedSamples)
});
export const benchmarkTimelineEvidenceSchema = z.strictObject({
    version: z.literal(1),
    events: z.number().int().nonnegative(),
    omitted: z.number().int().nonnegative(),
    status: z.enum([ 'pending', 'recorded', 'omitted' ]),
    reference: z.string().nullable(),
    reason: z.string().nullable()
});
export const benchmarkTimelineReportSchema = z.strictObject({
    version: z.literal(1),
    omitted: z.number().int().nonnegative(),
    events: z.array(z.strictObject({
        name: z.string(),
        source: z.enum([ 'harness', 'runtime', 'authored', 'process' ]),
        phase: z.enum([ 'warmup', 'measured' ]),
        sample: z.number().int().nonnegative(),
        clockDomain: z.string(),
        startMicroseconds: z.number().nonnegative(),
        durationMicroseconds: z.number().nonnegative().nullable(),
        outcome: z.enum([ 'complete', 'failed', 'incomplete' ])
    }))
});

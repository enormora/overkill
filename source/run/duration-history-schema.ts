import { z } from 'zod';

const metadataSchema = z
    .strictObject({
        processModel: z.union([
            z.literal('in-process'),
            z.literal('supervised-process'),
            z.literal('worker-pool')
        ]),
        profile: z.string(),
        scheduling: z.union([ z.literal('concurrent'), z.literal('serial') ]),
        testFamily: z.string(),
        workerLifecycle: z.union([ z.literal('fresh-worker-per-unit'), z.literal('reuse') ]).nullable()
    })
    .readonly();
export const durationObservationSchema = z
    .strictObject({
        durationMicroseconds: z.number().check(z.nonnegative()),
        metadata: metadataSchema,
        observedAt: z.iso.datetime({ offset: true })
    })
    .readonly();

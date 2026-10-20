import { z } from 'zod/v4';
import type { ReadonlyDeep } from 'type-fest';
import { metricReadingSchema } from '../packages/run/benchmark-calibration.entry-point.ts';
import { nodeChildReadingsSchema } from './process-node-readings.ts';

const captureSchema = z.strictObject({ text: z.string(), bytes: z.number().nonnegative(), truncated: z.boolean() });
export const processObservationSchema = z.strictObject({
    completion: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('exit'), code: z.number().int() }),
        z.strictObject({ kind: z.literal('ready') }),
        z.strictObject({ kind: z.literal('interaction') })
    ]),
    output: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('pipes'), stdout: captureSchema, stderr: captureSchema }),
        z.strictObject({ kind: z.literal('terminal'), terminal: captureSchema })
    ]),
    metadata: z.strictObject({
        version: z.literal(1),
        instrumentation: z.enum([ 'node', 'off' ]),
        runtime: z.string().nullable(),
        observationMicroseconds: z.number().nonnegative().nullable(),
        backend: z.enum([ 'pipes', 'pty' ]),
        terminal: z.strictObject({ name: z.string(), columns: z.number(), rows: z.number() }).nullable()
    })
});
export type ProcessObservation = ReadonlyDeep<z.infer<typeof processObservationSchema>>;
export const measuredProcessSchema = z.strictObject({
    value: processObservationSchema,
    metrics: z
        .object({
            ...nodeChildReadingsSchema.shape,
            durationMicroseconds: metricReadingSchema,
            operationsPerSecond: metricReadingSchema,
            firstOutputMilliseconds: metricReadingSchema,
            startupMilliseconds: metricReadingSchema,
            outputBytes: metricReadingSchema
        })
        .catchall(metricReadingSchema)
});
export type MeasuredProcess = ReadonlyDeep<z.infer<typeof measuredProcessSchema>>;

import { z } from 'zod/v4';
import type { ReadonlyDeep } from 'type-fest';
import { defaultAttachmentLimits } from '../packages/resources/attachment-context.entry-point.ts';
import { processRequestSchema } from './process-command.ts';
import { measuredProcessSchema, processObservationSchema } from './process-observation.ts';

export const processExecutionSchema = z.discriminatedUnion('status', [
    z.strictObject({
        status: z.literal('measured'),
        result: measuredProcessSchema,
        cleanupFailure: z.string().nullable()
    }),
    z.strictObject({
        status: z.literal('failed'),
        message: z.string(),
        output: processObservationSchema.shape.output,
        cleanupFailure: z.string().nullable()
    })
]);
export type ProcessExecution = ReadonlyDeep<z.infer<typeof processExecutionSchema>>;
export const processHelperRequestSchema = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('run'),
        id: z.number().int().nonnegative(),
        request: processRequestSchema,
        instrumentation: z.enum([ 'node', 'off' ]),
        maximumBytes: z.number().int().nonnegative().max(defaultAttachmentLimits.maxInlineBytes)
    }),
    z.strictObject({ kind: z.literal('cancel') }),
    z.strictObject({ kind: z.literal('close') })
]);
export type ProcessHelperRequest = ReadonlyDeep<z.infer<typeof processHelperRequestSchema>>;
export const processHelperReplySchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('ready'), version: z.literal(1) }),
    z.strictObject({
        kind: z.literal('started'),
        id: z.number().int().nonnegative(),
        pid: z.number().int().positive()
    }),
    z.strictObject({
        kind: z.literal('complete'),
        id: z.number().int().nonnegative(),
        execution: processExecutionSchema
    })
]);
export type ProcessHelperReply = ReadonlyDeep<z.infer<typeof processHelperReplySchema>>;

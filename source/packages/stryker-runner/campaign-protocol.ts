import { z } from 'zod/v4';
import type { JsonValue } from 'type-fest';
import { parseFrozenMicrotestPolicy, parseRunResult, parseRunExecutionFailure } from '../run/run.entry-point.ts';
import { campaignBaselineSchema } from './mutation-catalog.ts';
import { mutationSandboxSchema } from './mutation-sandbox.ts';

export const campaignProtocolVersion = 4;

const jsonSchema: z.ZodType<JsonValue> = z.json();

export const campaignEndpointSchema = z.strictObject({ port: z.number().int().positive(), token: z.uuid() }).readonly();
export type CampaignEndpoint = z.output<typeof campaignEndpointSchema>;
export const campaignSessionSchema = z.strictObject({
    policy: z.unknown().transform(parseFrozenMicrotestPolicy),
    seed: z.string().regex(/^(?:0|[1-9]\d*)$/u),
    lifecycle: z.strictObject({ moduleUrl: z.url(), exportName: z.string().min(1) })
});
export const campaignRequestSchema = z.strictObject({
    kind: z.literal('request'),
    version: z.literal(campaignProtocolVersion),
    token: z.uuid(),
    id: z.number().int().nonnegative(),
    timeoutMilliseconds: z.number().nullable(),
    request: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('register'), root: z.string().min(1) }),
        z.strictObject({ kind: z.literal('resolve-policy'), sandbox: mutationSandboxSchema, settings: z.unknown() }),
        z.strictObject({ kind: z.literal('publish'), baseline: campaignBaselineSchema }),
        z.strictObject({ kind: z.literal('fetch') }),
        z.strictObject({
            kind: z.literal('invoke'),
            session: campaignSessionSchema,
            data: jsonSchema
        }),
        z.strictObject({ kind: z.literal('release') })
    ])
});
export const campaignFrameSchema = z.union([
    campaignRequestSchema,
    z.strictObject({
        kind: z.literal('cancel'),
        version: z.literal(campaignProtocolVersion),
        token: z.uuid(),
        cancel: z.number().int().nonnegative(),
        reason: z.enum([ 'deadline', 'cancelled' ])
    })
]);
export type CampaignRequest = Readonly<z.input<typeof campaignRequestSchema>['request']>;
export const campaignResponseSchema = z.strictObject({
    version: z.literal(campaignProtocolVersion),
    id: z.number().int().nonnegative(),
    response: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('accepted') }),
        z.strictObject({ kind: z.literal('policy'), policy: z.unknown().transform(parseFrozenMicrotestPolicy) }),
        z.strictObject({ kind: z.literal('baseline'), baseline: campaignBaselineSchema.nullable() }),
        z.strictObject({ kind: z.literal('error'), message: z.string() }),
        z.strictObject({
            kind: z.literal('result'),
            result: z.unknown().transform(parseRunResult),
            data: jsonSchema,
            deadlineExceeded: z.boolean()
        }),
        z.strictObject({
            kind: z.literal('failure'),
            failure: z.unknown().transform(parseRunExecutionFailure),
            data: jsonSchema
        }),
        z.strictObject({ kind: z.literal('timeout'), data: jsonSchema })
    ])
});
export type CampaignResponse = Readonly<z.output<typeof campaignResponseSchema>['response']>;

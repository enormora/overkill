import { z } from 'zod/v4';
import { parseFrozenMicrotestPolicy } from '../run/run.entry-point.ts';

export const mutationPolicyRequestSchema = z.strictObject({
    kind: z.literal('resolve-policy'),
    cwd: z.string(),
    settings: z.unknown()
});

export const mutationPolicyResponseSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('policy'), policy: z.unknown().transform(parseFrozenMicrotestPolicy) }).readonly(),
    z.strictObject({ kind: z.literal('config-error'), message: z.string(), cause: z.string().nullable() }).readonly(),
    z
        .strictObject({
            kind: z.literal('resolution-error'),
            message: z.string(),
            code: z.enum([ 'invalid-request', 'no-tests-collected', 'unsupported-request' ])
        })
        .readonly(),
    z.strictObject({ kind: z.literal('error'), message: z.string() }).readonly()
]);

export type MutationPolicyResponse = z.output<typeof mutationPolicyResponseSchema>;

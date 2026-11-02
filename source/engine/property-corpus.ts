import { z } from 'zod/v4';
import { caseIdSchema, runtimeIdSchema, sourceLocationSchema } from './identity-schema.ts';

const codecIdentity = z.strictObject({ name: z.string(), version: z.number().int().positive() });
export const propertyWitnessSchema = z
    .strictObject({
        version: z.literal(1),
        kind: z.literal('property'),
        producedBy: z.strictObject({ library: z.string(), libraryVersion: z.string() }),
        case: caseIdSchema,
        runtimes: z.array(runtimeIdSchema),
        target: z.discriminatedUnion('kind', [
            z.strictObject({ kind: z.literal('property-value') }),
            z.strictObject({
                kind: z.literal('forall'),
                location: sourceLocationSchema,
                occurrence: z.number().int().nonnegative(),
                key: z.string().nullable()
            })
        ]),
        seed: z.string().regex(/^\d+$/v),
        failureIdentity: z.json().nullable(),
        shrinkPath: z.array(z.number().int().nonnegative()).nullable(),
        counterexample: z.strictObject({ format: codecIdentity, codec: codecIdentity, payload: z.json() })
    })
    .readonly();
export type PropertyWitnessFile = z.output<typeof propertyWitnessSchema>;
export type PropertyCorpusSnapshot = {
    readonly checkedIn: readonly PropertyWitnessFile[];
    readonly localCache: readonly PropertyWitnessFile[];
    readonly diagnostics: readonly { readonly path: string; readonly reason: string; }[];
};
export const emptyPropertyCorpus: PropertyCorpusSnapshot = { checkedIn: [], localCache: [], diagnostics: [] };

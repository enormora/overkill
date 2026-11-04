import { z } from 'zod/v4';
import { encodedPropertyInputSchema, propertyWitnessSchema } from '../engine/witness-file.ts';
import type { PropertyCaseEvidence } from '../engine/run-result.ts';
import { serializedValueSchema } from './serialized-value-schema.ts';

const observationSchema = z.strictObject({
    capture: z
        .discriminatedUnion('kind', [
            z.strictObject({ kind: z.literal('unavailable') }),
            z.strictObject({ kind: z.literal('codec-error'), reason: z.string() }),
            z.strictObject({
                kind: z.literal('encoded'),
                input: encodedPropertyInputSchema
            })
        ])
        .default({ kind: 'unavailable' }),
    input: serializedValueSchema,
    failure: serializedValueSchema
});

export const propertyEvidenceSchema: z.ZodType<PropertyCaseEvidence> = z.strictObject({
    invocations: z.array(z.strictObject({
        confirmedWitness: propertyWitnessSchema.nullable().default(null),
        shrinkStatus: z
            .enum([
                'in-progress',
                'search-exhausted',
                'work-exhausted',
                'non-reproducible',
                'interrupted',
                'execution-error',
                'shrinking-disabled',
                'failure-identity-unavailable',
                'shrink-state-unavailable'
            ])
            .nullable()
            .default(null),
        identity: z.string(),
        original: observationSchema,
        retained: observationSchema,
        diagnostics: z.array(z.strictObject({
            reason: z.string(),
            observation: observationSchema.nullable()
        }))
    }))
});

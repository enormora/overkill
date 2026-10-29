import { z } from 'zod/v4';
import type { PropertyCaseEvidence } from '../engine/run-result.ts';
import { serializedValueSchema } from './serialized-value-schema.ts';

const observationSchema = z.strictObject({
    input: serializedValueSchema,
    failure: serializedValueSchema
});

export const propertyEvidenceSchema: z.ZodType<PropertyCaseEvidence> = z.strictObject({
    invocations: z.array(z.strictObject({
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

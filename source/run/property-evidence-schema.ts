import { z } from 'zod/v4';
import { encodedPropertyInputSchema, propertyWitnessSchema } from '../engine/witness-file.ts';
import type { PropertyCaseEvidence } from '../engine/run-result.ts';
import { serializedValueSchema } from '../compare/serialized-value-schema.ts';

const percentScale = 100;

const propertyPhaseSchema = z.enum([
    'checked-in-corpus',
    'local-cache',
    'examples',
    'automatic-edges',
    'exhaustive',
    'exploration',
    'confirmation',
    'shrinking',
    'witness'
]);
const trialPositionSchema = z.strictObject({ phase: propertyPhaseSchema, index: z.number().int().positive() });
const unsignedSeedSchema = z.string().regex(/^\d+$/u);

const observationSchema = z.strictObject({
    trial: trialPositionSchema
        .nullable()
        .default(null),
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
    invocations: z.array(
        z
            .strictObject({
                summary: z
                    .strictObject({
                        status: z.enum([
                            'in-progress',
                            'completed',
                            'failed',
                            'coverage-unmet',
                            'generation-exhausted',
                            'work-exhausted',
                            'execution-error',
                            'interrupted'
                        ]),
                        trial: trialPositionSchema
                            .nullable(),
                        runSeed: unsignedSeedSchema,
                        propertySeed: unsignedSeedSchema,
                        witnessSeed: unsignedSeedSchema.nullable(),
                        seedVersion: z.literal('property-v1'),
                        accounting: z.strictObject({
                            phases: z.record(
                                propertyPhaseSchema,
                                z.strictObject({
                                    executed: z
                                        .number()
                                        .int()
                                        .nonnegative(),
                                    rejected: z
                                        .number()
                                        .int()
                                        .nonnegative()
                                })
                            ),
                            workConsumed: z.number().int().nonnegative()
                        }),
                        coverage: z.strictObject({
                            eligibleHits: z.record(z.string(), z.number().int().nonnegative()),
                            phaseDenominators: z.record(z.string(), z.number().int().nonnegative()),
                            denominator: z.number().int().nonnegative(),
                            requirements: z.array(
                                z.strictObject({
                                    label: z.string(),
                                    minimumPercent: z.number().min(0).max(percentScale)
                                })
                            ),
                            phases: z.record(z.string(), z.record(z.string(), z.number().int().nonnegative()))
                        }),
                        exhaustive: z
                            .strictObject({
                                domainSize: z.number().int().nonnegative(),
                                executed: z
                                    .number()
                                    .int()
                                    .nonnegative(),
                                traversal: z.enum([ 'incomplete', 'complete' ])
                            })
                            .nullable()
                    })
                    .nullable()
                    .default(null),
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
                original: observationSchema.nullable(),
                retained: observationSchema.nullable(),
                diagnostics: z.array(z.strictObject({
                    reason: z.string(),
                    observation: observationSchema.nullable()
                }))
            })
            .transform(function pairedObservations(value, context) {
                if (value.original === null && value.retained === null) {
                    return { ...value, original: null, retained: null };
                }
                if (value.original !== null && value.retained !== null) {
                    return { ...value, original: value.original, retained: value.retained };
                }
                context.addIssue({
                    code: 'custom',
                    message: 'Original and retained observations must be present together.'
                });
                return z.NEVER;
            })
    )
});

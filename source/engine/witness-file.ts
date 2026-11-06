import type { JsonValue } from 'type-fest';
import { z } from 'zod/v4';
import { caseIdSchema, runtimeIdSchema, sourceLocationSchema } from './identity-schema.ts';

const codecIdentity = z.strictObject({ name: z.string(), version: z.number().int().positive() });
const witnessHeaderSchema = z.strictObject({
    version: z.literal(1),
    producedBy: z.strictObject({ library: z.string(), libraryVersion: z.string() }),
    case: caseIdSchema
});
export type WitnessHeader = Readonly<z.output<typeof witnessHeaderSchema>>;
export type EncodedPropertyInput = {
    readonly format: { readonly name: string; readonly version: number; };
    readonly codec: { readonly name: string; readonly version: number; };
    readonly payload: JsonValue;
};
export const encodedPropertyInputSchema: z.ZodType<EncodedPropertyInput> = z.strictObject({
    format: codecIdentity,
    codec: codecIdentity,
    payload: z.json()
});
export const propertyWitnessSchema = z
    .strictObject({
        ...witnessHeaderSchema.shape,
        kind: z.literal('property'),
        runtimes: z.array(runtimeIdSchema),
        target: z
            .discriminatedUnion('kind', [
                z.strictObject({ kind: z.literal('property-value') }),
                z.strictObject({
                    kind: z.literal('forall'),
                    location: sourceLocationSchema,
                    occurrence: z.number().int().nonnegative(),
                    key: z.string().nullable()
                })
            ])
            .readonly(),
        seed: z.string().regex(/^\d+$/v),
        failureIdentity: z.json().nullable(),
        shrinkPath: z.array(z.number().int().nonnegative()).nullable(),
        counterexample: encodedPropertyInputSchema
    })
    .readonly();
export type PropertyWitnessFile = z.output<typeof propertyWitnessSchema>;
export type PropertyWitnessTarget = PropertyWitnessFile['target'];
const simulationWitnessSchema = z
    .strictObject({
        ...witnessHeaderSchema.shape,
        kind: z.literal('simulation'),
        seed: z.string().regex(/^-?\d+$/v).nullable(),
        simulation: z.strictObject({ name: z.string(), payload: z.json() }),
        resource: z.strictObject({ name: z.string() }).nullable(),
        scenario: z.string().nullable(),
        runtimeSnapshot: z.json(),
        faultConfiguration: z.json()
    })
    .readonly();
export type SimulationWitnessFile = z.output<typeof simulationWitnessSchema>;
export const witnessFileSchema = z.union([ propertyWitnessSchema, simulationWitnessSchema ]);
export type WitnessFile = PropertyWitnessFile | SimulationWitnessFile;

export function parseWitnessFile(value: unknown): WitnessFile {
    return witnessFileSchema.parse(value);
}

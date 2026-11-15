import { isAbsolute } from 'node:path';
import { z } from 'zod/v4';
import { workIdSchema } from '../engine/identity-schema.ts';
import { snapshotFamilyValue } from '../engine/test-family.ts';
import type { FrozenFamilyDefinition } from './family-catalog.ts';

export const familyValueSchema = z.json().transform(snapshotFamilyValue);
export const frozenFamilyDefinitionSchema: z.ZodType<FrozenFamilyDefinition> = z.strictObject({
    checkpoint: z
        .strictObject({
            preparation: z.strictObject({
                id: z.string(),
                version: z.string(),
                settings: familyValueSchema,
                preparation: familyValueSchema
            }),
            catalog: familyValueSchema
        })
        .nullable()
        .default(null),
    processModel: z.enum([ 'in-process', 'supervised-process', 'worker-pool' ]),
    definitionLocationCapture: z.enum([ 'enabled', 'disabled' ]),
    projectRoot: z.string().refine(isAbsolute),
    selection: z.array(workIdSchema).nullable().default(null),
    id: z.string().min(1),
    version: z.string().min(1),
    settings: familyValueSchema,
    source: z.discriminatedUnion('kind', [
        z.strictObject({
            kind: z.literal('builtin'),
            id: z.enum([ 'benchmark', 'integration', 'microtest', 'property' ])
        }),
        z.strictObject({ kind: z.literal('config-file'), configPath: z.string().min(1), profile: z.string().min(1) }),
        z.strictObject({
            kind: z.literal('module'),
            module: z.strictObject({ moduleUrl: z.url(), exportName: z.string().min(1) })
        })
    ])
});

export const familyRunFactsSchema = z.strictObject({
    id: z.string().min(1),
    version: z.string().min(1),
    settings: familyValueSchema,
    preparation: familyValueSchema,
    collection: familyValueSchema
});
export const collectedFamilyMetadataSchema = z.strictObject({
    definition: frozenFamilyDefinitionSchema,
    facts: familyRunFactsSchema
});

import { isAbsolute } from 'node:path';
import { z } from 'zod/v4';
import { workIdSchema } from '../engine/identity-schema.ts';
import { maxJsonDepth } from '../attachments/json-snapshot.ts';
import type { FamilyValue } from '../engine/test-family.ts';
import type { CollectedFamilyMetadata, FrozenFamilyDefinition } from './family-catalog.ts';

function invalidFamilyEvidence(reason: string): never {
    throw new TypeError('Family settings require lossless, acyclic JSON.', {
        cause: new TypeError('Portable inputs require lossless, acyclic JSON.', {
            cause: new TypeError(reason)
        })
    });
}

function freezeFamilyEvidence(value: FamilyValue, depth: number): void {
    if (typeof value !== 'object' || value === null) {
        if (Object.is(value, -0)) {
            invalidFamilyEvidence('Portable inputs require lossless JSON numbers.');
        }
        return;
    }
    if (depth > maxJsonDepth) {
        invalidFamilyEvidence('Attachments require finite, acyclic JSON values with depth at most 64.');
    }
    for (const child of Object.values(value)) {
        freezeFamilyEvidence(child, depth + 1);
    }
    Object.freeze(value);
}

export const familyValueSchema = z.json().transform(function freeze(value) {
    freezeFamilyEvidence(value, 0);
    return value;
});
const familyPreparationSchema = z.strictObject({
    id: z.string(),
    version: z.string(),
    settings: familyValueSchema,
    preparation: familyValueSchema
});
const familyCheckpointSchema = z.strictObject({
    preparation: familyPreparationSchema,
    catalog: familyValueSchema
});
const familyDefinitionSchema = z.strictObject({
    checkpoint: familyCheckpointSchema.nullable().default(null),
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

export const frozenFamilyDefinitionSchema: z.ZodType<FrozenFamilyDefinition> = familyDefinitionSchema;

export const familyRunFactsSchema = z.strictObject({
    id: z.string().min(1),
    version: z.string().min(1),
    settings: familyValueSchema,
    preparation: familyValueSchema,
    collection: familyValueSchema
});
const collectedFamilyDefinitionSchema = familyDefinitionSchema.extend({
    checkpoint: familyCheckpointSchema.extend({
        preparation: z.union([ z.literal('family-facts'), familyPreparationSchema ])
    }).nullable().default(null)
});

export const collectedFamilyMetadataSchema: z.ZodType<CollectedFamilyMetadata> = z.strictObject({
    definition: collectedFamilyDefinitionSchema,
    facts: familyRunFactsSchema
}).transform(function restorePreparation({ definition, facts }) {
    const { checkpoint } = definition;
    const complete = checkpoint === null
        ? null
        : {
            catalog: checkpoint.catalog,
            preparation: checkpoint.preparation === 'family-facts'
                ? { id: facts.id, version: facts.version, settings: facts.settings, preparation: facts.preparation }
                : checkpoint.preparation
        };
    return { definition: { ...definition, checkpoint: complete }, facts };
});

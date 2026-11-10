import { z } from 'zod/v4';
import {
    familyVariantSchema,
    attemptIdSchema,
    caseIdSchema,
    runtimeIdSchema,
    workloadIdSchema
} from '../engine/identity-schema.ts';
import { runArtifactSubtypes } from '../engine/run-artifact.ts';

export const artifactIdentityFields = {
    familyVariant: familyVariantSchema.default(null),
    runtimes: z.array(runtimeIdSchema),
    sequence: z.number(),
    workload: workloadIdSchema.nullable()
};
export const runArtifactIdSchema = z.union([
    z.strictObject({
        ...artifactIdentityFields,
        subtype: z.enum(runArtifactSubtypes),
        attempt: z.null(),
        scope: z.strictObject({ kind: z.literal('run') })
    }),
    z.strictObject({
        ...artifactIdentityFields,
        subtype: z.enum(runArtifactSubtypes),
        attempt: attemptIdSchema,
        scope: z.strictObject({
            activeCases: z.array(caseIdSchema),
            case: caseIdSchema,
            confidence: z.enum([ 'active-case', 'concurrent-active' ]),
            kind: z.literal('case')
        })
    })
]);

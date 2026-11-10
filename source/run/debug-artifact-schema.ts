import { z } from 'zod/v4';
import { attemptIdSchema } from '../engine/identity-schema.ts';
import { testDebugPayloadSchema } from '../engine/test-debug.ts';
import type { TestDebugArtifact } from '../engine/run-artifact.ts';
import { runArtifactIdSchema } from './run-artifact-id-schema.ts';

export const debugArtifactSchema: z.ZodType<TestDebugArtifact> = z.strictObject({
    id: runArtifactIdSchema.and(z.object({
        subtype: z.literal('debug'),
        attempt: attemptIdSchema,
        scope: z.object({ kind: z.literal('case') })
    })),
    source: z.enum([ 'native', 'boundary-captured' ]),
    payload: testDebugPayloadSchema
});

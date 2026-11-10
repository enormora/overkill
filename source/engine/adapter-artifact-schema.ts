import { z } from 'zod/v4';
import { runArtifactIdSchema } from './run-artifact-id-schema.ts';

export const adapterArtifactSchema = z.strictObject({
    id: runArtifactIdSchema.and(z.object({ subtype: z.literal('adapter') })),
    payload: z.strictObject({ kind: z.literal('adapter'), adapter: z.string(), facts: z.json() }),
    source: z.literal('native')
});

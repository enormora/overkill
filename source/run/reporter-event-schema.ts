import { z } from 'zod/v4';
import { createDefaultWorkId } from '../engine/identity.ts';
import type { ReporterEvent } from '../engine/reporter.ts';
import {
    annotationsSchema,
    caseIdSchema,
    sourceLocationsSchema,
    suitePathSchema,
    workIdSchema
} from '../engine/identity-schema.ts';
import { runResultSchema, runnerErrorSchema } from './run-result-schema.ts';
import { runArtifactSchema, verdictSchema } from './run-artifact-schema.ts';
import { testOutcomeSchema } from './assertion-result-schema.ts';

const testFields = {
    attempt: z.number(),
    case: caseIdSchema,
    definitionLocations: sourceLocationsSchema,
    suitePath: suitePathSchema,
    workId: workIdSchema.optional()
};
const eventSchema = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('run-start'),
        facts: z.record(z.string(), z.unknown()),
        root: z.strictObject({ annotations: annotationsSchema, title: z.string() }),
        startedAt: z.string()
    }),
    z.strictObject({ kind: z.literal('run-end'), result: runResultSchema }),
    z.strictObject({ kind: z.literal('runner-error'), error: runnerErrorSchema }),
    z.strictObject({ kind: z.enum([ 'suite-start', 'suite-end' ]), suitePath: suitePathSchema }),
    z.strictObject({ ...testFields, kind: z.literal('test-start') }),
    z.strictObject({ ...testFields, kind: z.literal('test-progress'), note: z.string() }),
    z.strictObject({
        ...testFields,
        kind: z.literal('test-end'),
        completion: z.enum([ 'final', 'retry' ]),
        artifacts: z.array(runArtifactSchema),
        outcome: testOutcomeSchema.nullable(),
        verdict: verdictSchema,
        durationMicroseconds: z.number()
    })
]);
function hasCaseIdentity(
    event: z.infer<typeof eventSchema>
): event is Extract<z.infer<typeof eventSchema>, { readonly case: unknown; }> {
    return Object.hasOwn(event, 'case');
}
export const reporterEventSchema: z.ZodType<ReporterEvent> = eventSchema.transform(
    function normalizeWorkIdentity(event) {
        return hasCaseIdentity(event) ? { ...event, workId: event.workId ?? createDefaultWorkId(event.case) } : event;
    }
);

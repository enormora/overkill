import { z } from 'zod/v4';
import { runnerErrorSchema } from '../engine/runner-error-schema.ts';
import type { ReporterEvent } from '../engine/reporter.ts';
import {
    annotationsSchema,
    caseIdSchema,
    sourceLocationsSchema,
    suitePathSchema,
    executableWorkIdSchema
} from '../engine/identity-schema.ts';
import { resourceCheckSnapshotSchema, testOutcomeSchema } from '../engine/assertion-result-schema.ts';
import { propertyEvidenceSchema } from './property-evidence-schema.ts';
import { runResultSchema } from './run-result-schema.ts';
import { debugArtifactSchema, runArtifactSchema, verdictSchema } from './run-artifact-schema.ts';
import { benchmarkResultSchema } from './benchmark-result-schema.ts';

const testFields = {
    attempt: z.number().int().nonnegative(),
    case: caseIdSchema,
    definitionLocations: sourceLocationsSchema,
    suitePath: suitePathSchema,
    workId: executableWorkIdSchema
};
const eventSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('resource-check-progress'), snapshot: resourceCheckSnapshotSchema }),
    z.strictObject({ kind: z.literal('debug-checkpoint'), artifact: debugArtifactSchema }),
    z.strictObject({ ...testFields, kind: z.literal('property-progress'), property: propertyEvidenceSchema }),
    z.strictObject({ ...testFields, kind: z.literal('benchmark-progress'), benchmark: benchmarkResultSchema }),
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
        property: propertyEvidenceSchema.nullable().default(null),
        benchmark: benchmarkResultSchema.nullable().default(null),
        completion: z.enum([ 'final', 'retry' ]),
        artifacts: z.array(runArtifactSchema),
        outcome: testOutcomeSchema.nullable(),
        verdict: verdictSchema,
        durationMicroseconds: z.number()
    })
]);
export const reporterEventSchema: z.ZodType<ReporterEvent> = eventSchema;

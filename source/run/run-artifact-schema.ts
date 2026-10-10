import { z } from 'zod/v4';
import type { RunArtifact } from '../engine/run-result.ts';
import { attemptIdSchema, workIdSchema } from '../engine/identity-schema.ts';
import { testOutcomeSchema } from './assertion-result-schema.ts';
import { artifactIdentityFields, runArtifactIdSchema } from './run-artifact-id-schema.ts';
import { runtimeAttachmentArtifactSchema } from './attachment-wire-schema.ts';

export const verdictSchema = z.enum([
    'pass',
    'fail',
    'skip',
    'inconclusive',
    'crashed',
    'resource-exhausted',
    'runtime-policy'
]);
export const testAttemptSchema = z.strictObject({
    attempt: attemptIdSchema,
    durationMicroseconds: z.number(),
    outcome: testOutcomeSchema.nullable(),
    verdict: verdictSchema
});
const coverageMetricSchema = z.strictObject({ covered: z.number(), total: z.number() });
const hedgeEvidenceSchema = z.strictObject({
    attachments: z.array(runtimeAttachmentArtifactSchema),
    attempts: z.tuple([ testAttemptSchema ]).rest(testAttemptSchema),
    outcome: testOutcomeSchema.nullable(),
    verdict: verdictSchema
});
export const runArtifactSchema: z.ZodType<RunArtifact> = z.union([
    runtimeAttachmentArtifactSchema,
    z.strictObject({
        id: runArtifactIdSchema.and(z.object({ subtype: z.literal('log-capture') })),
        payload: z.strictObject({
            byteLength: z.number(),
            capturedAtMicroseconds: z.number(),
            kind: z.literal('captured-output'),
            stream: z.enum([ 'stderr', 'stdout' ]),
            text: z.string(),
            truncated: z.boolean()
        }),
        source: z.enum([ 'boundary-captured', 'native' ])
    }),
    z.strictObject({
        id: z.strictObject({
            ...artifactIdentityFields,
            subtype: z.literal('coverage'),
            attempt: z.null(),
            scope: z.strictObject({ kind: z.literal('run') })
        }),
        payload: z.strictObject({
            completeness: z.literal('complete'),
            directory: z.string(),
            kind: z.literal('coverage'),
            rawDataDirectory: z.string(),
            reports: z.array(
                z.strictObject({ format: z.enum([ 'html', 'json', 'lcov', 'text', 'v8' ]), path: z.string() })
            ),
            summary: z.strictObject({
                branches: coverageMetricSchema,
                functions: coverageMetricSchema,
                lines: coverageMetricSchema
            })
        }),
        source: z.literal('v8-native')
    }),
    z.strictObject({
        id: runArtifactIdSchema.and(z.object({ subtype: z.literal('hedged-conflict') })),
        payload: z.strictObject({
            authoritative: hedgeEvidenceSchema,
            conflicting: hedgeEvidenceSchema,
            kind: z.literal('hedged-conflict'),
            work: workIdSchema
        }),
        source: z.literal('native')
    })
]);

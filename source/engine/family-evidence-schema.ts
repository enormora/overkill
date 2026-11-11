import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod/v4';
import { adapterArtifactSchema } from './artifact-schema.ts';
import { testOutcomeSchema } from './assertion-result-schema.ts';
import { attemptIdSchema, caseIdSchema, workIdSchema } from './identity-schema.ts';
import type { TestOutcome } from './run-result.ts';
import { runnerErrorSchema } from './runner-error-schema.ts';

function analysisOutcome(outcome: TestOutcome): boolean {
    return outcome.kind !== 'fail' || outcome.failures.every(function analysisFailure(failure) {
        return failure.kind === 'assertion' || failure.kind === 'test-contract' && failure.code === 'no-assertions';
    });
}

const completion = {
    property: z.null(),
    benchmark: z.null(),
    durationMicroseconds: z.number().nonnegative(),
    outcome: testOutcomeSchema,
    verdict: z.enum([ 'pass', 'fail', 'inconclusive' ])
};

const analysisResultSchema = z
    .strictObject({
        ...completion,
        attempts: z.tuple([ z.strictObject({ ...completion, attempt: attemptIdSchema }) ]),
        retried: z.null(),
        definitionLocations: z.array(z.unknown()).min(1),
        id: caseIdSchema,
        workId: workIdSchema
    })
    .refine(function consistentResult(result) {
        const [ attempt ] = result.attempts;
        return result.verdict === result.outcome.kind && attempt.attempt.index === 0 &&
            isDeepStrictEqual(
                [ attempt.verdict, attempt.durationMicroseconds, attempt.outcome ],
                [ result.verdict, result.durationMicroseconds, result.outcome ]
            ) && analysisOutcome(result.outcome);
    }, 'Analysis evidence requires one consistent non-runtime attempt.');

export const familyEventSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('case-start'), workId: workIdSchema }),
    z.strictObject({ kind: z.literal('case-progress'), workId: workIdSchema, note: z.string() }),
    z.strictObject({
        kind: z.literal('case-end'),
        result: analysisResultSchema,
        artifacts: z.array(adapterArtifactSchema)
    }),
    z.strictObject({ kind: z.literal('run-error'), error: runnerErrorSchema }),
    z.strictObject({ kind: z.literal('artifact'), artifact: adapterArtifactSchema })
]);

export type AnalysisEvent = Readonly<z.output<typeof familyEventSchema>>;

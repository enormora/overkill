import { z } from 'zod/v4';
import { runnerErrorSchema } from '../engine/runner-error-schema.ts';
import { collectedRunPlanSchema } from './collected-run-plan-schema.ts';
import { reporterEventSchema } from './reporter-event-schema.ts';
import { runResultSchema } from './run-result-schema.ts';
import { processUsageSnapshotSchema, runTimingSpanSchema } from './run-runtime-schema.ts';
import type { SupervisedChildMessage } from './supervised-protocol.ts';

export const supervisedChildMessageSchema: z.ZodType<SupervisedChildMessage> = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.enum([ 'execution-data', 'execution-checkpoint' ]), data: z.json() }),
    z.strictObject({
        kind: z.literal('collected'),
        collectedPlan: collectedRunPlanSchema,
        runnerErrors: z.array(runnerErrorSchema)
    }),
    z.strictObject({ kind: z.literal('event'), event: reporterEventSchema }),
    z.strictObject({ kind: z.literal('result'), result: runResultSchema }),
    z.strictObject({ kind: z.literal('sample'), sample: processUsageSnapshotSchema }),
    z.strictObject({ kind: z.literal('timing'), span: runTimingSpanSchema })
]);

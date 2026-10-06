import { z } from 'zod/v4';
import type {
    SupervisedChildCommand,
    SupervisedAssignmentCommand,
    SupervisedChildMessage
} from './supervised-protocol.ts';
import { caseIdSchema, workIdSchema } from './run-identity-schema.ts';
import { executionCommandFields } from './run-command-schema.ts';
import { collectedRunPlanSchema } from './collected-run-plan-schema.ts';
import { reporterEventSchema } from './reporter-event-schema.ts';
import { runResultSchema, runnerErrorSchema } from './run-result-schema.ts';
import { resourceUsageSnapshotSchema, runTimingSpanSchema } from './run-runtime-schema.ts';
import { attachmentEndpointSchema } from './attachment-wire-schema.ts';

const commandSchema: z.ZodType<SupervisedChildCommand> = z.strictObject({
    ...executionCommandFields,
    kind: z.enum([ 'collect', 'run' ]),
    capabilityRestrictions: z.strictObject({ mode: z.enum([ 'disabled', 'enabled' ]) }),
    capture: z.enum([ 'buffered', 'live' ])
});
const assignmentSchema: z.ZodType<SupervisedAssignmentCommand> = z.union([
    z.strictObject({
        kind: z.literal('assign'),
        assignedWork: z.array(workIdSchema),
        attachmentEndpoint: attachmentEndpointSchema.nullable()
    }),
    z.strictObject({
        kind: z.literal('assign'),
        assignedCases: z.array(caseIdSchema),
        attachmentEndpoint: attachmentEndpointSchema.nullable()
    })
]);
export const supervisedParentMessageSchema: z.ZodType<SupervisedAssignmentCommand | SupervisedChildCommand> = z.union([
    commandSchema,
    assignmentSchema
]);
export const supervisedChildMessageSchema: z.ZodType<SupervisedChildMessage> = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('collected'),
        collectedPlan: collectedRunPlanSchema,
        runnerErrors: z.array(runnerErrorSchema)
    }),
    z.strictObject({ kind: z.literal('event'), event: reporterEventSchema }),
    z.strictObject({ kind: z.literal('result'), result: runResultSchema }),
    z.strictObject({ kind: z.literal('sample'), sample: resourceUsageSnapshotSchema }),
    z.strictObject({ kind: z.literal('timing'), span: runTimingSpanSchema })
]);

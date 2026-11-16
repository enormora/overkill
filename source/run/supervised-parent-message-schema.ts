import { z } from 'zod/v4';
import { implementationCatalogSchema } from '../implementation-catalog.ts';
import { caseIdSchema, workIdSchema } from '../engine/identity-schema.ts';
import { frozenSupervisedCommandSchema, sessionSupervisedCommandSchema } from './frozen-supervised-command-schema.ts';
import type {
    SupervisedChildCommand,
    SupervisedAssignmentCommand
} from './supervised-protocol.ts';
import {
    supervisedCommandFields,
    propertyCorpusSnapshotSchema,
    witnessReplayCommandSchema
} from './run-command-schema.ts';
import {
    assignedPropertyPoliciesSchema,
    workloadInputsSchema
} from './collected-run-plan-schema.ts';
import { attachmentEndpointSchema } from './attachment-wire-schema.ts';

const commandSchema: z.ZodType<SupervisedChildCommand> = z.union([
    witnessReplayCommandSchema,
    z.strictObject({ ...supervisedCommandFields, kind: z.literal('collect') }),
    z.strictObject({ ...supervisedCommandFields, kind: z.literal('run') }),
    frozenSupervisedCommandSchema,
    sessionSupervisedCommandSchema
]);
const assignmentSchema: z.ZodType<SupervisedAssignmentCommand> = z.union([
    z.strictObject({
        kind: z.literal('assign'),
        implementations: implementationCatalogSchema.nullable().default(null),
        corpus: propertyCorpusSnapshotSchema,
        assignedWork: z.array(workIdSchema),
        propertyPolicies: assignedPropertyPoliciesSchema.default([]),
        workloadInputs: workloadInputsSchema.default([]),
        attachmentEndpoint: attachmentEndpointSchema.nullable()
    }),
    z.strictObject({
        kind: z.literal('assign'),
        implementations: implementationCatalogSchema.nullable().default(null),
        assignedCases: z.array(caseIdSchema),
        attachmentEndpoint: attachmentEndpointSchema.nullable()
    })
]);
export const supervisedParentMessageSchema: z.ZodType<SupervisedAssignmentCommand | SupervisedChildCommand> = z.union([
    commandSchema,
    assignmentSchema
]);

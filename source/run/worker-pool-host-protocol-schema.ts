import { z } from 'zod/v4';
import type {
    WorkerPoolHostCommand,
    WorkerPoolHostMessage,
    SerializedWorkerPoolMessage
} from './worker-pool-host-protocol.ts';
import { hostProcessSchema } from './run-command-schema.ts';
import { workerPoolTaskSchema } from './worker-pool-task-schema.ts';
import { runnerErrorSchema } from './run-result-schema.ts';
import { resourceUsageSchema, resourceUsageSnapshotSchema, runTimingSpanSchema } from './run-runtime-schema.ts';
import { reporterEventSchema } from './reporter-event-schema.ts';
import { workIdSchema, attemptIdSchema } from './run-identity-schema.ts';

const serializedWorkerMessageSchema: z.ZodType<SerializedWorkerPoolMessage> = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('prepare-resource-artifacts'),
        request: z.string(),
        work: workIdSchema,
        attempt: attemptIdSchema
    }),
    z.strictObject({ kind: z.literal('event'), event: reporterEventSchema }),
    z.strictObject({ kind: z.literal('timing'), span: runTimingSpanSchema }),
    z.strictObject({
        kind: z.literal('attempt-completed'),
        attempt: z.templateLiteral([ 'attempt-', z.number() ]),
        durationMicroseconds: z.number()
    }),
    z.strictObject({
        kind: z.literal('attempt-started'),
        attempt: z.templateLiteral([ 'attempt-', z.number() ]),
        workerId: z.templateLiteral([ z.number(), ':', z.number() ])
    }),
    z.strictObject({ kind: z.literal('task-messages-completed') }),
    z.strictObject({
        kind: z.literal('output'),
        capturedAtMicroseconds: z.number(),
        chunkBase64: z.base64(),
        stream: z.enum([ 'stderr', 'stdout' ])
    })
]);
export const workerPoolHostCommandSchema: z.ZodType<WorkerPoolHostCommand> = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('task-reply'),
        taskId: z.string(),
        reply: z.strictObject({
            kind: z.literal('resource-artifacts-prepared'),
            request: z.string(),
            runnerErrors: z.array(runnerErrorSchema)
        })
    }),
    z.strictObject({ kind: z.literal('abort-task'), taskId: z.string() }),
    z.strictObject({
        kind: z.literal('configure'),
        options: z.strictObject({
            cwd: z.string(),
            hostProcess: hostProcessSchema,
            testFamily: z.enum([ 'microtest', 'integration' ]),
            workerCount: z.number().int().positive(),
            workerLifecycle: z.enum([ 'fresh-worker-per-unit', 'reuse' ])
        })
    }),
    z.strictObject({ kind: z.enum([ 'destroy', 'finish-resource-tracking' ]) }),
    z.strictObject({ kind: z.literal('run-task'), task: workerPoolTaskSchema, taskId: z.string() }),
    z.strictObject({ kind: z.literal('start-resource-tracking'), samplingIntervalMilliseconds: z.number() })
]);
export const workerPoolHostMessageSchema: z.ZodType<WorkerPoolHostMessage> = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('runner-error'), error: runnerErrorSchema }),
    z.strictObject({ kind: z.enum([ 'configured', 'destroyed' ]) }),
    z.strictObject({ kind: z.literal('resource-sample'), sample: resourceUsageSnapshotSchema }),
    z.strictObject({ kind: z.literal('resource-usage'), resourceUsage: resourceUsageSchema }),
    z.strictObject({
        kind: z.literal('task-error'),
        error: z.strictObject({
            code: z.string().nullable(),
            message: z.string(),
            name: z.string(),
            permission: z.string().nullable(),
            resource: z.string().nullable(),
            stack: z.string().nullable()
        }),
        taskId: z.string()
    }),
    z.strictObject({ kind: z.literal('task-message'), message: serializedWorkerMessageSchema, taskId: z.string() }),
    z.strictObject({ kind: z.literal('task-result'), result: z.unknown(), taskId: z.string() })
]);

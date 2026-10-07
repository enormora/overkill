import { z } from 'zod/v4';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import {
    attachmentChunkBytes,
    attachmentMetadataBytes,
    type AttachmentEndpoint,
    type AttachmentReply,
    type AttachmentRequest
} from './attachment-protocol.ts';

const maxTcpPort = 65_535;
export const attachmentEndpointSchema: z.ZodType<AttachmentEndpoint> = z.strictObject({
    port: z.number().int().min(1).max(maxTcpPort),
    token: z.string(),
    branch: z.string().nullable(),
    limits: z.strictObject({
        maxInlineBytes: z.number().int().positive(),
        maxArtifactBytes: z.number().int().positive(),
        maxScopeBytes: z.number().int().positive(),
        maxScopeAttachments: z.number().int().positive()
    })
});

const caseSchema = z.object({
    file: z.string().nullable(),
    params: z.string().nullable(),
    suite: z.array(z.string()),
    title: z.string()
});
const runtimeSchema = z.object({
    dimensions: z.record(z.string(), z.string()),
    name: z.string(),
    scenarios: z.record(z.string(), z.string()),
    variantId: z.string().nullable()
});
const workloadSchema = z.object({ name: z.string(), params: z.record(z.string(), z.string()) });
const attemptSchema = z.object({ index: z.number().int().nonnegative() });
const workSchema = z.object({
    case: caseSchema,
    runtimes: z.array(runtimeSchema),
    workload: workloadSchema.nullable()
});
const ownerSchema = z.union([
    z.object({ kind: z.literal('run') }),
    z.object({ attempt: attemptSchema, kind: z.literal('case'), work: workSchema })
]);
const conditionSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('attempt'), work: workSchema, attempt: attemptSchema }),
    z.object({ kind: z.literal('resource'), resource: z.string(), boundary: z.string() })
]);
const producerSchema = z.union([
    z.object({ kind: z.literal('case') }),
    z.object({ kind: z.literal('resource'), name: z.string().max(attachmentMetadataBytes) })
]);
const writerSchema = z.number().int().nonnegative();
const metadataSchema = z.object({
    mediaType: z.string().max(attachmentMetadataBytes),
    name: z.string().max(attachmentMetadataBytes)
});
const base64Quantum = 3;
const base64Chars = 4;
const maxEncodedChunk = Math.ceil(attachmentChunkBytes / base64Quantum) * base64Chars;
export const attachmentRequestSchema: z.ZodType<AttachmentRequest> = z.object({
    request: writerSchema,
    token: z.string(),
    operation: z.discriminatedUnion('kind', [
        z.object({
            branch: z.string().nullable(),
            contentKind: z.enum([ 'binary', 'json', 'text' ]),
            kind: z.literal('open'),
            metadata: metadataSchema,
            owner: ownerSchema,
            producer: producerSchema
        }),
        z.object({ kind: z.literal('resource-failure'), boundary: z.string() }),
        z.object({ kind: z.literal('resource-consumer'), boundary: z.string(), work: workSchema }),
        z.object({
            branch: z.string().nullable(),
            contentKind: z.enum([ 'binary', 'json', 'text' ]),
            kind: z.literal('prepare'),
            metadata: metadataSchema,
            owner: ownerSchema,
            producer: producerSchema,
            condition: conditionSchema,
            source: z.enum([ 'instrumented', 'boundary-captured', 'native' ]),
            subtype: z.enum([ 'attachment', 'witness' ])
        }),
        z.object({
            data: z.string().max(maxEncodedChunk).regex(/^[A-Za-z0-9+/]*={0,2}$/u),
            kind: z.literal('write'),
            writer: writerSchema
        }),
        z.object({ kind: z.literal('omit'), writer: writerSchema }),
        z.object({
            kind: z.literal('close'),
            reason: z.enum([ 'complete', 'unclosed', 'write-error', 'capture-limit' ]),
            writer: writerSchema
        })
    ])
});
const completionSchema = z.union([
    z.object({ kind: z.literal('complete') }),
    z.object({
        kind: z.literal('incomplete'),
        reason: z.enum([ 'byte-limit', 'interrupted', 'unclosed', 'write-error', 'capture-limit' ])
    })
]);
const inlineCompletionSchema = z.union([
    completionSchema,
    z.object({ kind: z.literal('truncated'), reason: z.literal('byte-limit') })
]);
const contentSchema = z.discriminatedUnion('kind', [
    z.object({
        byteLength: writerSchema,
        completion: inlineCompletionSchema,
        kind: z.literal('text'),
        text: z.string()
    }),
    z.object({ byteLength: writerSchema, kind: z.literal('json'), value: z.json() }),
    z.object({ byteLength: writerSchema, completion: completionSchema, kind: z.literal('file'), path: z.string() }),
    z.object({ kind: z.literal('omitted'), limit: writerSchema, reason: z.enum([ 'byte-limit', 'count-limit' ]) })
]);
const artifactBaseSchema = z.object({
    runtimes: z.array(runtimeSchema),
    sequence: writerSchema,
    subtype: z.enum([ 'attachment', 'witness' ]),
    workload: workloadSchema.nullable()
});
const artifactIdSchema = z.union([
    artifactBaseSchema.extend({ attempt: z.null(), scope: z.object({ kind: z.literal('run') }) }),
    artifactBaseSchema.extend({
        attempt: attemptSchema,
        scope: z.object({
            activeCases: z.array(caseSchema),
            case: caseSchema,
            confidence: z.enum([ 'active-case', 'concurrent-active' ]),
            kind: z.literal('case')
        })
    })
]);
export const runtimeAttachmentArtifactSchema: z.ZodType<RuntimeAttachmentArtifact> = z.object({
    id: artifactIdSchema,
    payload: metadataSchema
        .extend({
            capturedAtMicroseconds: z.number(),
            content: contentSchema,
            kind: z.literal('runtime-attachment'),
            producer: producerSchema
        })
        .and(z.discriminatedUnion('capture', [
            z.object({ capture: z.literal('opt-in') }),
            z.object({
                capture: z.literal('automatic'),
                retention: z.object({ condition: conditionSchema, state: z.enum([ 'prepared', 'retained' ]) })
            })
        ])),
    source: z.enum([ 'instrumented', 'boundary-captured', 'native' ])
});
export const attachmentReplySchema: z.ZodType<AttachmentReply> = z.object({
    request: writerSchema,
    result: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('opened'), writer: writerSchema }),
        z.object({ kind: z.literal('written') }),
        z.object({ artifact: runtimeAttachmentArtifactSchema, kind: z.literal('closed') }),
        z.object({ kind: z.literal('error'), message: z.string(), reason: z.string() })
    ])
});

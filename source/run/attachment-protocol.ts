import { workIdentityKey, type AttemptId, type WorkId } from '../engine/identity.ts';
import type {
    AttachmentLimits,
    FailureArtifactCondition,
    AttachmentMetadata,
    AttachmentProducer,
    RuntimeAttachmentArtifact
} from '../engine/runtime-attachment.ts';

export type AttachmentEndpoint = {
    readonly port: number;
    readonly token: string;
    readonly limits: AttachmentLimits;
    readonly branch: string | null;
};

type CaseAttachmentOwner = {
    readonly kind: 'case';
    readonly work: WorkId;
    readonly attempt: AttemptId;
};
export type AttachmentOwner = CaseAttachmentOwner | { readonly kind: 'run'; };
export type AttachmentCloseReason = 'capture-limit' | 'complete' | 'unclosed' | 'write-error';
type AttachmentOpen = {
    readonly kind: 'open';
    readonly metadata: AttachmentMetadata;
    readonly contentKind: 'binary' | 'json' | 'text';
    readonly owner: AttachmentOwner;
    readonly producer: AttachmentProducer;
    readonly branch: string | null;
};
type PreparedAttachmentOpen = {
    readonly metadata: AttachmentMetadata;
    readonly contentKind: 'binary' | 'json' | 'text';
    readonly owner: AttachmentOwner;
    readonly producer: AttachmentProducer;
    readonly branch: string | null;
    readonly kind: 'prepare';
    readonly condition: FailureArtifactCondition;
    readonly source: 'boundary-captured' | 'instrumented' | 'native';
    readonly subtype: 'attachment' | 'witness';
};
type AttachmentWrite = { readonly kind: 'write'; readonly writer: number; readonly data: string; };
type AttachmentClose = {
    readonly kind: 'close';
    readonly writer: number;
    readonly reason: AttachmentCloseReason;
};
type AttachmentOmit = { readonly kind: 'omit'; readonly writer: number; };
type AttachmentOperationsByKind = {
    readonly resourceFailure: { readonly kind: 'resource-failure'; readonly boundary: string; };
    readonly resourceConsumer: {
        readonly kind: 'resource-consumer';
        readonly boundary: string;
        readonly work: WorkId;
    };
    readonly close: AttachmentClose;
    readonly omit: AttachmentOmit;
    readonly open: AttachmentOpen;
    readonly prepare: PreparedAttachmentOpen;
    readonly write: AttachmentWrite;
};
export type AttachmentOperation = AttachmentOperationsByKind[keyof AttachmentOperationsByKind];
export type AttachmentRequest = {
    readonly request: number;
    readonly token: string;
    readonly operation: AttachmentOperation;
};
type OpenedAttachment = { readonly kind: 'opened'; readonly writer: number; };
type WrittenAttachment = { readonly kind: 'written'; };
type ClosedAttachment = { readonly kind: 'closed'; readonly artifact: RuntimeAttachmentArtifact; };
type RejectedAttachment = { readonly kind: 'error'; readonly message: string; readonly reason: string; };
export type AttachmentResponse = ClosedAttachment | OpenedAttachment | RejectedAttachment | WrittenAttachment;
export type AttachmentReply = { readonly request: number; readonly result: AttachmentResponse; };
export type AttachmentExchange = (operation: AttachmentOperation) => Promise<AttachmentResponse>;
export const attachmentChunkBytes = 65_536;
export const attachmentMetadataBytes = 256;
export const attachmentMaxFrameBytes = 131_072;

export const attachmentMaxPendingRequests = 256;

export function attachmentScopeKey(owner: AttachmentOwner): string {
    return owner.kind === 'run' ? 'run' : workIdentityKey(owner.work);
}

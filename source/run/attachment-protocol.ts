import type { AttemptId, WorkId } from '../engine/identity.ts';
import type {
    AttachmentLimits,
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
export type AttachmentCloseReason = 'complete' | 'unclosed' | 'write-error';
type AttachmentOpen = {
    readonly kind: 'open';
    readonly metadata: AttachmentMetadata;
    readonly contentKind: 'binary' | 'json' | 'text';
    readonly owner: AttachmentOwner;
    readonly producer: AttachmentProducer;
    readonly branch: string | null;
};
type AttachmentWrite = { readonly kind: 'write'; readonly writer: number; readonly data: string; };
type AttachmentClose = {
    readonly kind: 'close';
    readonly writer: number;
    readonly reason: AttachmentCloseReason;
};
type AttachmentOmit = { readonly kind: 'omit'; readonly writer: number; };
export type AttachmentOperation = AttachmentClose | AttachmentOmit | AttachmentOpen | AttachmentWrite;
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

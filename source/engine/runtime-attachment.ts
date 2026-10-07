import type { JsonValue, ReadonlyDeep } from 'type-fest';
import type { AttemptId, WorkId } from './identity.ts';
import type { RunArtifactId } from './run-artifact.ts';

export type AttachmentMetadata = {
    readonly name: string;
    readonly mediaType: string;
};

export type AttachmentCompletion = { readonly kind: 'complete'; } | {
    readonly kind: 'incomplete';
    readonly reason: 'byte-limit' | 'capture-limit' | 'interrupted' | 'unclosed' | 'write-error';
} | { readonly kind: 'truncated'; readonly reason: 'byte-limit'; };

export type AttachmentContent = {
    readonly kind: 'file';
    readonly path: string;
    readonly byteLength: number;
    readonly completion: Exclude<AttachmentCompletion, { readonly kind: 'truncated'; }>;
} | {
    readonly kind: 'json';
    readonly value: ReadonlyDeep<JsonValue>;
    readonly byteLength: number;
} | {
    readonly kind: 'omitted';
    readonly reason: 'byte-limit' | 'count-limit';
    readonly limit: number;
} | {
    readonly kind: 'text';
    readonly text: string;
    readonly byteLength: number;
    readonly completion: AttachmentCompletion;
};

export type AttachmentProducer = { readonly kind: 'case'; } | {
    readonly kind: 'resource';
    readonly name: string;
};

export type FailureArtifactCondition = {
    readonly kind: 'attempt';
    readonly work: WorkId;
    readonly attempt: AttemptId;
} | {
    readonly kind: 'resource';
    readonly resource: string;
    readonly boundary: string;
};

type ExplicitAttachmentCapture = { readonly capture: 'opt-in'; };
type AutomaticAttachmentCapture = {
    readonly capture: 'automatic';
    readonly retention: {
        readonly condition: FailureArtifactCondition;
        readonly state: 'prepared' | 'retained';
    };
};

export type RuntimeAttachmentArtifact = {
    readonly id: RunArtifactId & { readonly subtype: 'attachment' | 'witness'; };
    readonly source: 'boundary-captured' | 'instrumented' | 'native';
    readonly payload: AttachmentMetadata & {
        readonly kind: 'runtime-attachment';
        readonly capturedAtMicroseconds: number;
        readonly producer: AttachmentProducer;
        readonly content: AttachmentContent;
    } & (AutomaticAttachmentCapture | ExplicitAttachmentCapture);
};

export type AttachmentWriter<Chunk> = {
    readonly write: (chunk: Chunk) => Promise<void>;
    readonly close: (...reason: readonly ['capture-limit'] | readonly []) => Promise<RuntimeAttachmentArtifact>;
};

export type RuntimeAttachments = {
    readonly open: {
        (metadata: AttachmentMetadata & { readonly kind: 'text'; }): Promise<AttachmentWriter<Uint8Array | string>>;
        (metadata: AttachmentMetadata & { readonly kind: 'binary'; }): Promise<AttachmentWriter<Uint8Array>>;
    };
    readonly json: (metadata: AttachmentMetadata, value: unknown) => Promise<RuntimeAttachmentArtifact>;
    readonly file: (metadata: AttachmentMetadata, path: string) => Promise<RuntimeAttachmentArtifact>;
};

export type AttachmentLimits = {
    readonly maxInlineBytes: number;
    readonly maxArtifactBytes: number;
    readonly maxScopeBytes: number;
    readonly maxScopeAttachments: number;
};

export const defaultAttachmentLimits: AttachmentLimits = Object.freeze({
    maxInlineBytes: 1_048_576,
    maxArtifactBytes: 10_485_760,
    maxScopeBytes: 10_485_760,
    maxScopeAttachments: 100
});

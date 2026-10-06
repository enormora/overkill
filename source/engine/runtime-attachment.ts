import type { JsonValue, ReadonlyDeep } from 'type-fest';
import type { RunArtifactId } from './run-artifact.ts';

export type AttachmentMetadata = {
    readonly name: string;
    readonly mediaType: string;
};

export type AttachmentCompletion = { readonly kind: 'complete'; } | {
    readonly kind: 'incomplete';
    readonly reason: 'byte-limit' | 'interrupted' | 'unclosed' | 'write-error';
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

export type RuntimeAttachmentArtifact = {
    readonly id: RunArtifactId & { readonly subtype: 'attachment'; };
    readonly source: 'instrumented';
    readonly payload: AttachmentMetadata & {
        readonly kind: 'runtime-attachment';
        readonly capture: 'opt-in';
        readonly capturedAtMicroseconds: number;
        readonly producer: AttachmentProducer;
        readonly content: AttachmentContent;
    };
};

export type AttachmentWriter<Chunk> = {
    readonly write: (chunk: Chunk) => Promise<void>;
    readonly close: () => Promise<RuntimeAttachmentArtifact>;
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

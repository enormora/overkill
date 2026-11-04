import type { SerializedValue } from '../compare/serialized-value.ts';
import type { PropertyWitnessFile } from '../engine/property-corpus.ts';

export type CorpusSource = {
    readonly kind: 'cache-entry';
    readonly path: string;
    readonly entryId: string;
} | { readonly kind: 'path'; readonly path: string; };
export type CorpusCodec = { readonly kind: 'built-in'; } | {
    readonly kind: 'module';
    readonly path: string;
    readonly exportName: string;
};
export type CorpusRequest = {
    readonly cwd: string;
    readonly source: CorpusSource;
    readonly codec: CorpusCodec;
};
export type CorpusEntryInspection = {
    readonly entryId: string | null;
    readonly witness: PropertyWitnessFile;
    readonly preview: SerializedValue;
};
export type CorpusInspection = {
    readonly sourcePath: string;
    readonly entries: readonly CorpusEntryInspection[];
    readonly diagnostics: readonly string[];
};
export type CorpusWritePreview = {
    readonly source: CorpusEntryInspection;
    readonly output: CorpusEntryInspection;
};
export type CorpusWriteRequest = CorpusRequest & {
    readonly destination: string;
    readonly beforeWrite: (preview: CorpusWritePreview) => Promise<void>;
};
export type CorpusWriteResult = { readonly destination: string; readonly entry: CorpusEntryInspection; };
type CorpusReadErrorCode = 'codec-execution' | 'compatibility' | 'invalid-source' | 'selection';
type CorpusWriteErrorCode = 'destination-conflict' | 'filesystem' | 'preview-delivery';
export type CorpusOperationErrorCode = CorpusReadErrorCode | CorpusWriteErrorCode;
export class CorpusOperationError extends Error {
    private readonly errorCode: CorpusOperationErrorCode;
    public constructor(message: string, options: ErrorOptions, code: CorpusOperationErrorCode) {
        super(message, options);
        this.name = 'CorpusOperationError';
        this.errorCode = code;
    }

    public code(): CorpusOperationErrorCode {
        return this.errorCode;
    }
}

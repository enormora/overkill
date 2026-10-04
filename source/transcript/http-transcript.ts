import {
    createTranscriptStore,
    type TranscriptScope,
    type TranscriptStore,
    type TranscriptView
} from './transcript-store.ts';

export const httpTranscriptBodyByteLimit = Number('16384');

type CompleteHttpBody = { readonly bytes: Uint8Array; readonly kind: 'complete'; };
type TruncatedHttpBody = {
    readonly bytes: Uint8Array;
    readonly kind: 'truncated';
    readonly originalByteLength: number;
};
type AbsentHttpBody = { readonly kind: 'absent'; };
type UnavailableHttpBody = {
    readonly kind: 'unavailable';
    readonly reason: 'body-not-observed' | 'transport-does-not-expose-body';
};

export type RecordedHttpBody = AbsentHttpBody | CompleteHttpBody | TruncatedHttpBody | UnavailableHttpBody;

export type HttpHeadersSnapshot = readonly (readonly [name: string, value: string])[];

export type HttpRequestSnapshot = {
    readonly body: RecordedHttpBody;
    readonly headers: HttpHeadersSnapshot;
    readonly method: string;
    readonly url: string;
};

export type HttpResponseSnapshot = {
    readonly body: RecordedHttpBody;
    readonly headers: HttpHeadersSnapshot;
    readonly status: number;
    readonly statusText: string;
};

export type RecordedHttpError = {
    readonly message: string;
    readonly name: string;
};

type HttpErrorOutcome = { readonly error: RecordedHttpError; readonly kind: 'error'; };
type HttpIncompleteOutcome = { readonly kind: 'incomplete'; readonly reason: 'resource-disposed'; };
type HttpResponseOutcome = { readonly kind: 'response'; readonly response: HttpResponseSnapshot; };

export type HttpInteractionOutcome = HttpErrorOutcome | HttpIncompleteOutcome | HttpResponseOutcome;

export type HttpInteraction<Context> = {
    readonly context: Context;
    readonly outcome: HttpInteractionOutcome;
    readonly request: HttpRequestSnapshot;
    readonly sequence: number;
};

export type HttpTranscriptEntry<Context = null> = readonly ['http', HttpInteraction<Context>];

export type TranscriptCaptureErrorEntry = readonly ['capture-error', {
    readonly message: string;
    readonly source: 'custom' | 'node-http' | 'undici';
}];

export type HttpTranscript<Context = null> = TranscriptView<
    HttpTranscriptEntry<Context> | TranscriptCaptureErrorEntry
>;

export type HttpTranscriptRecorder<Context> = {
    readonly nextSequence: () => number;
    readonly record: (interaction: HttpInteraction<Context>, scope: TranscriptScope | null) => void;
    readonly recordCaptureError: (
        source: TranscriptCaptureErrorEntry[1]['source'],
        error: unknown,
        scope: TranscriptScope | null
    ) => void;
    readonly transcript: HttpTranscript<Context>;
};

export function recordedHttpBody(body: Uint8Array | null): RecordedHttpBody {
    if (body === null || body.byteLength === 0) {
        return { kind: 'absent' };
    }

    if (body.byteLength <= httpTranscriptBodyByteLimit) {
        return { bytes: Uint8Array.from(body), kind: 'complete' };
    }

    return {
        bytes: Uint8Array.from(body.subarray(0, httpTranscriptBodyByteLimit)),
        kind: 'truncated',
        originalByteLength: body.byteLength
    };
}

export function httpHeadersSnapshot(headers: Headers): HttpHeadersSnapshot {
    return Object.freeze(Array.from(headers.entries(), function entry([ name, value ]) {
        return Object.freeze([ name.toLowerCase(), value ] as const);
    }));
}

export function recordedHttpError(error: unknown): RecordedHttpError {
    return error instanceof Error
        ? { message: error.message, name: error.name }
        : { message: String(error), name: 'Error' };
}

export function createHttpTranscriptRecorder<Context>(): HttpTranscriptRecorder<Context> {
    const store: TranscriptStore<HttpTranscriptEntry<Context> | TranscriptCaptureErrorEntry> = createTranscriptStore();
    let sequence = 0;

    return Object.freeze({
        nextSequence() {
            const current = sequence;

            sequence += 1;

            return current;
        },
        record(interaction, scope) {
            store.recordInScope(scope, 'http', interaction);
        },
        recordCaptureError(source, error, scope) {
            const entry: TranscriptCaptureErrorEntry = [ 'capture-error', {
                message: error instanceof Error ? error.message : String(error),
                source
            } ];

            store.recordInScope(scope, ...entry);
        },
        transcript: store.view
    });
}

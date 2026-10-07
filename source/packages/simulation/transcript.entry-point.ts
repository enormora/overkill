import * as httpTranscript from '../../transcript/http-transcript.ts';
import * as transcriptStore from '../../transcript/transcript-store.ts';
import * as transcriptArtifact from '../../transcript/http-transcript-artifact.ts';
import type {
    HttpHeadersSnapshot as CoreHttpHeadersSnapshot,
    HttpInteraction as CoreHttpInteraction,
    HttpInteractionOutcome as CoreHttpInteractionOutcome,
    HttpRequestSnapshot as CoreHttpRequestSnapshot,
    HttpResponseSnapshot as CoreHttpResponseSnapshot,
    HttpTranscript as CoreHttpTranscript,
    HttpTranscriptEntry as CoreHttpTranscriptEntry,
    HttpTranscriptRecorder as CoreHttpTranscriptRecorder,
    RecordedHttpBody as CoreRecordedHttpBody,
    RecordedHttpError as CoreRecordedHttpError,
    TranscriptCaptureErrorEntry as CoreTranscriptCaptureErrorEntry,
    TranscriptEntry as CoreTranscriptEntry,
    TranscriptScope as CoreTranscriptScope,
    TranscriptView as CoreTranscriptView
} from '../../transcript/http-transcript.ts';

export const {
    captureErrorHttpTranscript,
    createHttpTranscriptRecorder,
    emptyTranscriptView,
    httpHeadersSnapshot,
    httpTranscriptBodyByteLimit,
    recordedHttpBody,
    recordedHttpError
} = httpTranscript;

export type HttpHeadersSnapshot = CoreHttpHeadersSnapshot;
export type HttpInteraction<Context> = CoreHttpInteraction<Context>;
export type HttpInteractionOutcome = CoreHttpInteractionOutcome;
export type HttpRequestSnapshot = CoreHttpRequestSnapshot;
export type HttpResponseSnapshot = CoreHttpResponseSnapshot;
export type HttpTranscript<Context = null> = CoreHttpTranscript<Context>;
export type HttpTranscriptEntry<Context = null> = CoreHttpTranscriptEntry<Context>;
export type HttpTranscriptRecorder<Context> = CoreHttpTranscriptRecorder<Context>;
export type RecordedHttpBody = CoreRecordedHttpBody;
export type RecordedHttpError = CoreRecordedHttpError;
export type TranscriptCaptureErrorEntry = CoreTranscriptCaptureErrorEntry;
export type TranscriptEntry = CoreTranscriptEntry;
export type TranscriptScope = CoreTranscriptScope;
export type TranscriptView<Entry extends TranscriptEntry = TranscriptEntry> = CoreTranscriptView<Entry>;

export const { observeTranscriptEntries, runWithTranscriptScope } = transcriptStore;
export const { httpTranscriptArtifactEntry } = transcriptArtifact;

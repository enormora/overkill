import { createFailureArtifactStream, type FailureArtifactStream } from '../attachments/failure-artifact-stream.ts';
import {
    currentResourceFailureContext,
    attemptFailureContext,
    transcriptAttempt
} from '../attachments/resource-failure-context.ts';
import {
    observeTranscriptEntries,
    httpTranscriptArtifactEntry,
    type HttpTranscript,
    type TranscriptScope
} from '../packages/simulation/transcript.entry-point.ts';

export type HttpFailureCapture = { readonly close: () => Promise<void>; };
export function observeHttpFailureArtifacts(name: string, view: HttpTranscript<unknown>): HttpFailureCapture | null {
    const currentContext = currentResourceFailureContext();
    if (currentContext === null) {
        return null;
    }
    const failureContext = currentContext;
    const streams = new Map<TranscriptScope | null, FailureArtifactStream>();
    let failure: Error | null = null;
    function appendEntry(
        entry: Parameters<typeof httpTranscriptArtifactEntry>[0],
        scope: TranscriptScope | null
    ): void {
        const identity = transcriptAttempt(scope);
        const owner = identity === null ? failureContext : attemptFailureContext(name, identity.work, identity.attempt);
        const stream = streams.get(scope) ??
            createFailureArtifactStream(owner, 'instrumented', 'http-transcript', 'application/x-ndjson');
        if (stream === null) {
            return;
        }
        streams.set(scope, stream);
        stream.write(`${JSON.stringify(httpTranscriptArtifactEntry(entry))}\n`);
    }
    const stop = observeTranscriptEntries(view, function captureEntry(entry, scope) {
        try {
            appendEntry(entry, scope);
        } catch (error: unknown) {
            failure = new Error('HTTP transcript capture failed.', { cause: error });
        }
    });
    return {
        async close() {
            stop();
            await Promise.all(Array.from(streams.values(), async function closeHttpCapture(stream) {
                return stream.close();
            }));
            if (failure !== null) {
                throw failure;
            }
        }
    };
}

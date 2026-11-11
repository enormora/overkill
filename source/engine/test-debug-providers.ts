import { serializeValue, type SerializedValue } from '../compare/serialized-value.ts';
import type { ExecuteCaseInput } from './case-attempt-context.ts';
import type { RunnerError } from './run-result.ts';
import type { DebugAttempt } from './test-debug-recording.ts';
import type { DebugRecordingProvider, TestDebugPayload } from './test-debug.ts';

type Recording = TestDebugPayload['recordings'][number];
type CapturedRecording = { readonly kind: 'captured'; readonly recording: Recording; };
type FailedRecording = { readonly kind: 'failed'; readonly recording: Recording; readonly error: unknown; };
type RecordingCapture = CapturedRecording | FailedRecording;
function retainedEvents(attempt: DebugAttempt, provider: DebugRecordingProvider): readonly SerializedValue[] {
    const events: SerializedValue[] = [];
    const recorded = provider.recorded();
    for (const event of recorded) {
        const encoded = attempt.retainValue(event);
        if (encoded === null) {
            attempt.drop(recorded.length - events.length);
            return events;
        }
        events.push(encoded);
    }
    return events;
}
function boundedProviderError(attempt: DebugAttempt, error: unknown): SerializedValue {
    const encoded = attempt.retainValue(error);
    if (encoded !== null) {
        return encoded;
    }
    attempt.drop(1);
    return serializeValue('Debug provider error details exceeded the capture limit.');
}
function captureProvider(attempt: DebugAttempt, provider: DebugRecordingProvider): RecordingCapture {
    try {
        return {
            kind: 'captured',
            recording: { name: provider.name, events: retainedEvents(attempt, provider), error: null }
        };
    } catch (error: unknown) {
        return {
            kind: 'failed',
            error,
            recording: { name: provider.name, events: [], error: boundedProviderError(attempt, error) }
        };
    }
}
export function debugFailure(input: ExecuteCaseInput, error: unknown, message: string): RunnerError {
    return {
        subtype: 'artifact',
        message,
        cause: error,
        attributedTo: input.testCase.id,
        attributedToWork: input.testCase.workId,
        attributedToAttempt: { index: input.attempt },
        diagnostics: []
    };
}
async function reportProviderFailure(input: ExecuteCaseInput, error: unknown): Promise<void> {
    const failure = debugFailure(input, error, 'Debug recording provider failed.');
    input.supervision.recordRunnerError(failure);
    const errors = await input.context.reporterDelivery.reportEvent({ kind: 'runner-error', error: failure });
    for (const deliveryError of errors) {
        input.supervision.recordRunnerError(deliveryError);
    }
}
export async function readRecordings(input: ExecuteCaseInput, attempt: DebugAttempt): Promise<readonly Recording[]> {
    const recordings: Recording[] = [];
    for (const provider of attempt.recordingProviders()) {
        const capture = captureProvider(attempt, provider);
        recordings.push(capture.recording);
        if (capture.kind === 'failed') {
            await reportProviderFailure(input, capture.error);
        }
    }
    return recordings;
}

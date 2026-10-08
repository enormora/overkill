import type { JsonValue, ReadonlyDeep } from 'type-fest';
import { serializeValue } from '../compare/serialized-value.ts';
import type {
    HttpTranscriptEntry,
    RecordedHttpBody,
    TranscriptCaptureErrorEntry
} from './http-transcript.ts';

function bodyArtifact(body: RecordedHttpBody): ReadonlyDeep<JsonValue> {
    return body.kind === 'complete' || body.kind === 'truncated'
        ? { ...body, bytes: Buffer.from(body.bytes).toString('base64'), encoding: 'base64' }
        : body;
}

export function httpTranscriptArtifactEntry(
    entry: HttpTranscriptEntry<unknown> | TranscriptCaptureErrorEntry
): ReadonlyDeep<JsonValue> {
    if (entry[0] === 'capture-error') {
        return entry;
    }
    const interaction = entry[1];
    const outcome = interaction.outcome.kind === 'response'
        ? {
            ...interaction.outcome,
            response: { ...interaction.outcome.response, body: bodyArtifact(interaction.outcome.response.body) }
        }
        : interaction.outcome;
    return [ 'http', {
        ...interaction,
        context: serializeValue(interaction.context),
        outcome,
        request: { ...interaction.request, body: bodyArtifact(interaction.request.body) }
    } ];
}

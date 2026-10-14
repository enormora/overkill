import type { RunResult } from '../engine/run-result.ts';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import { snapshotJson } from './json-snapshot.ts';

type RunJsonArtifactInput = {
    readonly result: RunResult;
    readonly name: string;
    readonly mediaType: string;
    readonly value: unknown;
    readonly maxBytes: number;
    readonly capturedAtMicroseconds: number;
};
export function runJsonArtifact(input: RunJsonArtifactInput): RuntimeAttachmentArtifact {
    const snapshot = snapshotJson(input.value, input.maxBytes);
    if (snapshot === null) {
        throw new Error(`${input.name} report exceeds the configured artifact byte limit.`);
    }
    const sequence = input.result.artifacts.reduce(function nextSequence(next, artifact) {
        return Math.max(next, artifact.id.sequence + 1);
    }, 0);
    return {
        id: { attempt: null, runtimes: [], scope: { kind: 'run' }, sequence, subtype: 'attachment', workload: null },
        payload: {
            capture: 'opt-in',
            capturedAtMicroseconds: input.capturedAtMicroseconds,
            content: { byteLength: Buffer.byteLength(snapshot.encoded), kind: 'json', value: snapshot.value },
            kind: 'runtime-attachment',
            mediaType: input.mediaType,
            name: input.name,
            producer: { kind: 'case' }
        },
        source: 'native'
    };
}

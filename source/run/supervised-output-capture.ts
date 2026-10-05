import type { Except } from 'type-fest';
import { workIdentityKey, type AttemptId, type WorkId } from '../engine/identity.ts';
import type { CapturedOutputArtifact, RunArtifactScope } from '../engine/run-artifact.ts';

export const capturedOutputLimitBytes = 1_048_576;

type CapturedWork = {
    readonly attempt: AttemptId;
    readonly work: WorkId;
};

type CaseOutputId = Except<Extract<CapturedOutputArtifact['id'], { readonly attempt: AttemptId; }>, 'sequence'>;
type RunOutputId = Except<Extract<CapturedOutputArtifact['id'], { readonly attempt: null; }>, 'sequence'>;

type OutputAttribution = {
    readonly id: CaseOutputId | RunOutputId;
    readonly key: string;
};

function caseAttribution(active: CapturedWork, activeCases: readonly WorkId['case'][]): OutputAttribution {
    const scope: Extract<RunArtifactScope, { readonly kind: 'case'; }> = {
        activeCases,
        case: active.work.case,
        confidence: activeCases.length === 1 ? 'active-case' : 'concurrent-active',
        kind: 'case'
    };
    return {
        id: {
            attempt: active.attempt,
            runtimes: active.work.runtimes,
            scope,
            subtype: 'log-capture',
            workload: active.work.workload
        },
        key: workIdentityKey(active.work)
    };
}

function outputAttributions(activeWork: readonly CapturedWork[]): readonly OutputAttribution[] {
    if (activeWork.length === 0) {
        return [ {
            id: { attempt: null, runtimes: [], scope: { kind: 'run' }, subtype: 'log-capture', workload: null },
            key: 'run'
        } ];
    }
    const activeCases = activeWork.map(function caseIdentity(active) {
        return active.work.case;
    });
    return activeWork.map(function attribution(active) {
        return caseAttribution(active, activeCases);
    });
}

type OutputCaptureWindow = { readonly capturedAtMicroseconds: number; readonly availableBytes: number; };

function outputArtifact(
    id: CapturedOutputArtifact['id'],
    stream: 'stderr' | 'stdout',
    chunk: Uint8Array,
    capture: OutputCaptureWindow
): CapturedOutputArtifact {
    const byteLength = Math.min(capture.availableBytes, chunk.length);
    return {
        id,
        payload: {
            byteLength,
            capturedAtMicroseconds: capture.capturedAtMicroseconds,
            kind: 'captured-output',
            stream,
            text: Buffer.from(chunk.subarray(0, byteLength)).toString('utf8'),
            truncated: byteLength < chunk.length
        },
        source: 'boundary-captured'
    };
}

type SupervisedOutputCapture = {
    readonly record: (
        activeWork: readonly CapturedWork[],
        stream: 'stderr' | 'stdout',
        chunk: Uint8Array,
        capturedAtMicroseconds: number
    ) => readonly CapturedOutputArtifact[];
};

export function createSupervisedOutputCapture(): SupervisedOutputCapture {
    const byteCounts = new Map<string, number>();
    let sequence = 0;
    return {
        record(
            activeWork: readonly CapturedWork[],
            stream: 'stderr' | 'stdout',
            chunk: Uint8Array,
            capturedAtMicroseconds: number
        ) {
            return outputAttributions(activeWork).map(function recordOutput(attribution) {
                const used = byteCounts.get(attribution.key) ?? 0;
                const id: CapturedOutputArtifact['id'] = { ...attribution.id, sequence };
                const artifact = outputArtifact(
                    id,
                    stream,
                    chunk,
                    { capturedAtMicroseconds, availableBytes: Math.max(0, capturedOutputLimitBytes - used) }
                );
                byteCounts.set(attribution.key, used + artifact.payload.byteLength);
                sequence += 1;
                return artifact;
            });
        }
    };
}

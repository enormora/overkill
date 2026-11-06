import type { RunArtifact } from '../engine/run-result.ts';

export function witnessReplayLines(artifacts: readonly RunArtifact[]): readonly string[] {
    return artifacts.flatMap(function replayableWitness(artifact) {
        const { content } = artifact.payload.kind === 'runtime-attachment' ? artifact.payload : { content: null };
        if (artifact.id.subtype !== 'witness' || content?.kind !== 'file' || content.completion.kind !== 'complete') {
            return [];
        }
        const quotedPath = `'${content.path.replaceAll("'", "'\\''")}'`;
        return [ `Replay: overkill replay-witness ${quotedPath}` ];
    });
}

import { workIdentityKey } from '../engine/identity.ts';
import { isTestDebugArtifact, type RunArtifact } from '../engine/run-result.ts';

function artifactKey(artifact: RunArtifact, index: number): string {
    if (!isTestDebugArtifact(artifact)) {
        return `ordinary:${index.toString()}`;
    }
    const work = { case: artifact.id.scope.case, runtimes: artifact.id.runtimes, workload: artifact.id.workload };
    return `debug:${workIdentityKey(work)}:${artifact.id.attempt.index.toString()}:${artifact.id.sequence.toString()}`;
}
function replacesPrevious(previous: RunArtifact | undefined, next: RunArtifact): boolean {
    if (previous === undefined || !isTestDebugArtifact(previous) || !isTestDebugArtifact(next)) {
        return true;
    }
    return next.source === 'native' || previous.source !== 'native';
}
export function mergeDebugArtifacts(artifacts: readonly RunArtifact[]): readonly RunArtifact[] {
    const merged = new Map<string, RunArtifact>();
    for (const artifact of artifacts) {
        const key = artifactKey(artifact, merged.size);
        if (replacesPrevious(merged.get(key), artifact)) {
            merged.set(key, artifact);
        }
    }
    return Array.from(merged.values());
}

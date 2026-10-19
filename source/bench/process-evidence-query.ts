import type { RunArtifact, RunResult } from '../engine/run-result.ts';
import { workIdentityKey, type WorkId } from '../engine/identity.ts';

export const processEvidenceMediaType = 'application/vnd.overkill.benchmark-processes+json';

export function processEvidenceForWork(result: RunResult, work: WorkId): readonly RunArtifact[] {
    return result.artifacts.filter(function ownedProcessEvidence(artifact) {
        if (artifact.id.scope.kind !== 'case' || artifact.payload.kind !== 'runtime-attachment') {
            return false;
        }
        const artifactWork = {
            case: artifact.id.scope.case,
            runtimes: artifact.id.runtimes,
            workload: artifact.id.workload
        };
        return artifact.payload.mediaType === processEvidenceMediaType &&
            workIdentityKey(artifactWork) === workIdentityKey(work);
    });
}

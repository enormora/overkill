import type { RunArtifact, RunResult } from '../engine/run-result.ts';
import { workIdentityKey, type WorkId } from '../engine/identity.ts';

export const processEvidenceMediaType = 'application/vnd.overkill.benchmark-processes+json';

export function createProcessEvidenceReader(result: RunResult): (work: WorkId) => readonly RunArtifact[] {
    const owned = result.artifacts.flatMap(function ownedProcessEvidence(artifact) {
        if (
            artifact.id.scope.kind !== 'case' || artifact.payload.kind !== 'runtime-attachment' ||
            artifact.payload.mediaType !== processEvidenceMediaType
        ) {
            return [];
        }
        const artifactWork = {
            case: artifact.id.scope.case,
            runtimes: artifact.id.runtimes,
            workload: artifact.id.workload
        };
        return [ { owner: workIdentityKey(artifactWork), artifact } ];
    });
    const byWork = Map.groupBy(owned, function workOwner(entry) {
        return entry.owner;
    });
    return function readProcessEvidence(work) {
        return (byWork.get(workIdentityKey(work)) ?? []).map(function retainedArtifact(entry) {
            return entry.artifact;
        });
    };
}

export function processEvidenceForWork(result: RunResult, work: WorkId): readonly RunArtifact[] {
    return createProcessEvidenceReader(result)(work);
}

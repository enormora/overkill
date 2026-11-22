import path from 'node:path';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import type { RunArtifact, RunResult } from '../packages/engine/engine.entry-point.ts';
import { witnessReplayLines } from '../reporters/witness-replay-lines.ts';

function witnessArtifacts(result: RunResult): readonly RunArtifact[] {
    return result.artifacts.filter(function retainedWitness(artifact) {
        return artifact.id.subtype === 'witness';
    });
}

export function retainedWitnessFile(result: RunResult, directory: string): string {
    const artifact = witnessArtifacts(result)[0];
    if (artifact?.payload.kind !== 'runtime-attachment' || artifact.payload.content.kind !== 'file') {
        throw new TypeError('Expected a retained property witness file.');
    }
    return path.resolve(directory, artifact.payload.content.path);
}

export const retainedWitnessEvidence = defineCompositeAssertion({
    name: 'retains a replayable property witness file',
    assert(check, result: RunResult) {
        const artifacts = witnessArtifacts(result);
        const artifact = artifacts[0];
        if (artifact?.payload.kind !== 'runtime-attachment' || artifact.payload.content.kind !== 'file') {
            throw new TypeError('Expected a retained property witness file.');
        }
        return check.group([
            check.equal(artifacts.length, 1),
            check.includes(witnessReplayLines(artifacts)[0] ?? '', artifact.payload.content.path)
        ]);
    }
});

import {
    preparedResourceAttachments,
    currentAttachmentLimits
} from '../packages/resources/attachment-context.entry-point.ts';
import type { AttemptId, WorkId } from '../engine/identity.ts';
import type { RuntimeAttachments, RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import type { FailureArtifactAttachments } from '../resources/failure-artifacts.ts';
import { snapshotAttachmentJson } from './attachment-json.ts';

async function retainWitness(
    target: RuntimeAttachments,
    snapshot: ReturnType<typeof snapshotAttachmentJson>,
    witness: unknown
): Promise<RuntimeAttachmentArtifact> {
    const metadata = { name: 'scenario-witness', mediaType: 'application/json' };
    if (snapshot === null) {
        return await target.json(metadata, witness);
    }
    const writer = await target.open({ ...metadata, kind: 'binary' });
    await writer.write(Buffer.from(snapshot.encoded));
    return await writer.close();
}

export function simulationWitnessAttachments(
    attachments: RuntimeAttachments,
    resource: string,
    work: WorkId,
    attempt: AttemptId
): FailureArtifactAttachments {
    return {
        ...attachments,
        async witness(input) {
            const target = preparedResourceAttachments(
                resource,
                { kind: 'attempt', work, attempt },
                'native',
                'witness'
            );
            if (target === null) {
                throw new TypeError('Simulation witnesses require runner-managed integration execution.');
            }
            const limits = currentAttachmentLimits();
            if (limits === null) {
                throw new TypeError('Simulation witnesses require attachment limits.');
            }
            const witness = {
                ...input,
                version: 1,
                case: work.case,
                kind: 'simulation',
                resource: { name: resource },
                seed: input.seed === null ? null : input.seed.toString()
            };
            const snapshot = snapshotAttachmentJson(witness, limits.maxArtifactBytes);
            const artifact = await retainWitness(target, snapshot, witness);
            return { ...artifact, id: { ...artifact.id, subtype: 'witness' }, source: 'native' };
        }
    };
}

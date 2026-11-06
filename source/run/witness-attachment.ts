import { parseWitnessFile } from '../engine/witness-file.ts';
import type {
    AttachmentMetadata,
    RuntimeAttachments,
    RuntimeAttachmentArtifact
} from '../engine/runtime-attachment.ts';
import { snapshotJson } from '../attachments/json-snapshot.ts';

export async function retainWitnessAttachment(
    target: RuntimeAttachments,
    metadata: AttachmentMetadata,
    witness: unknown,
    maxBytes: number
): Promise<RuntimeAttachmentArtifact> {
    const snapshot = snapshotJson(witness, maxBytes);
    if (snapshot === null) {
        return await target.json(metadata, witness);
    }
    parseWitnessFile(snapshot.value);
    const writer = await target.open({ ...metadata, kind: 'binary' });
    await writer.write(Buffer.from(snapshot.encoded));
    return await writer.close();
}

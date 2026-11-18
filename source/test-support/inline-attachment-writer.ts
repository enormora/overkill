import type { AttachmentStore } from '../run/attachment-store.ts';
import type { AttachmentOperation } from '../run/attachment-protocol.ts';

type OpenOperation = Extract<AttachmentOperation, { readonly kind: 'open' | 'prepare'; }>;
export async function openAttachmentWriter(
    store: AttachmentStore,
    channel: string,
    operation: OpenOperation
): Promise<number> {
    const reply = await store.exchange(channel, operation);
    if (reply.kind !== 'opened') {
        throw new Error(`Attachment was not opened: ${JSON.stringify(reply)}`);
    }
    return reply.writer;
}

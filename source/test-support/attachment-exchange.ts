import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import type { AttachmentExchange, AttachmentOperation, AttachmentResponse } from '../run/attachment-protocol.ts';

export const exchangedAttachment: RuntimeAttachmentArtifact = {
    id: {
        familyVariant: null,
        attempt: null,
        runtimes: [],
        scope: { kind: 'run' },
        sequence: 1,
        subtype: 'attachment',
        workload: null
    },
    source: 'native',
    payload: {
        kind: 'runtime-attachment',
        name: 'log',
        mediaType: 'text/plain',
        capture: 'opt-in',
        capturedAtMicroseconds: 0,
        producer: { kind: 'case' },
        content: { kind: 'text', text: 'saved', byteLength: 5, completion: { kind: 'complete' } }
    }
};

type RecordedAttachmentExchange = {
    readonly operations: readonly AttachmentOperation[];
    readonly exchange: AttachmentExchange;
};

export function recordAttachmentExchange(): RecordedAttachmentExchange {
    const operations: AttachmentOperation[] = [];
    return {
        operations,
        async exchange(operation): Promise<AttachmentResponse> {
            operations.push(operation);
            if (operation.kind === 'open' || operation.kind === 'prepare') {
                return { kind: 'opened', writer: operations.length };
            }
            return operation.kind === 'close' ? { kind: 'closed', artifact: exchangedAttachment } : { kind: 'written' };
        }
    };
}

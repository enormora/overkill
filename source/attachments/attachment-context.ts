import { AsyncLocalStorage } from 'node:async_hooks';
import type { AttachmentProducer, RuntimeAttachments } from '../engine/runtime-attachment.ts';

export type AttachmentContext = {
    readonly forProducer: (producer: AttachmentProducer) => RuntimeAttachments;
};

type AttachmentContextStorage = Readonly<AsyncLocalStorage<AttachmentContext>>;
const attachmentContextKey = Symbol.for('@overkill-dev/runtime-attachment-context/v1');

function isAttachmentContextStorage(value: unknown): value is AttachmentContextStorage {
    return value instanceof AsyncLocalStorage;
}
function sharedAttachmentContext(): AttachmentContextStorage {
    const existing: unknown = Reflect.get(globalThis, attachmentContextKey);
    if (isAttachmentContextStorage(existing)) {
        return existing;
    }
    const created = new AsyncLocalStorage<AttachmentContext>();
    Object.defineProperty(globalThis, attachmentContextKey, { value: created });
    return created;
}
const attachmentContext = sharedAttachmentContext();

function unavailableAttachments(): RuntimeAttachments {
    const unavailable = async function rejectUnmanagedAttachment(): Promise<never> {
        throw new TypeError('Runtime attachments require runner-managed integration execution.');
    };

    return Object.freeze({ open: unavailable, json: unavailable, file: unavailable });
}

export function attachmentsForProducer(producer: AttachmentProducer): RuntimeAttachments {
    return attachmentContext.getStore()?.forProducer(producer) ?? unavailableAttachments();
}

export function resourceAttachments(name: string): RuntimeAttachments {
    return attachmentsForProducer({ kind: 'resource', name });
}

export async function runWithAttachmentContext<Value>(
    context: AttachmentContext,
    run: () => Promise<Value>
): Promise<Value> {
    return await attachmentContext.run(context, run);
}

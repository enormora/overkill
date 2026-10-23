import { createJsonFrameCheck } from '../../json-frame-check.ts';

export {
    attachmentsForProducer,
    currentAttachmentLimits,
    resourceAttachments,
    preparedResourceAttachments,
    runWithAttachmentContext
} from '../../attachments/attachment-context.ts';
export type { AttachmentContext } from '../../attachments/attachment-context.ts';
export { defaultAttachmentLimits } from '../../engine/runtime-attachment.ts';

export function boundedJsonFrames(limit: number, context: string): TransformStream<Uint8Array, Uint8Array> {
    const check = createJsonFrameCheck(limit, context);
    return new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk: unknown, controller) {
            const checked = check(chunk);
            if (checked instanceof Error) {
                throw checked;
            }
            controller.enqueue(checked);
        }
    });
}

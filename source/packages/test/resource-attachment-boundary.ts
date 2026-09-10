import { isResourceAttachedTestBody, type TestFamily } from '../engine/engine.entry-point.ts';

const microtestResourceAttachmentError = 'Microtest authoring does not support resource or runtime attachments.';

export function assertMicrotestResourceFreeBody(testFamily: TestFamily, body: unknown): void {
    if (testFamily === 'microtest' && isResourceAttachedTestBody(body)) {
        throw new TypeError(microtestResourceAttachmentError);
    }
}

import type { AttachmentFile } from '../run/attachment-retention.ts';

type AttachmentFileScenario = {
    readonly maximumWrite: number;
    readonly failedWrite: number;
    readonly writeFailure: Error | null;
    readonly closeFailure: Error | null;
};
export const attachmentFileScenario: AttachmentFileScenario = {
    maximumWrite: 1024,
    failedWrite: 1,
    writeFailure: null,
    closeFailure: null
};
type MemoryAttachmentFile = {
    readonly file: AttachmentFile;
    readonly events: readonly string[];
    readonly content: () => string;
};
export function attachmentFile(input: AttachmentFileScenario): MemoryAttachmentFile {
    const chunks: Uint8Array[] = [];
    const events: string[] = [];
    let writes = 0;
    return {
        events,
        content() {
            return Buffer.concat(chunks).toString();
        },
        file: {
            async write(chunk) {
                writes += 1;
                if (writes === input.failedWrite && input.writeFailure !== null) {
                    throw input.writeFailure;
                }
                const bytesWritten = Math.min(chunk.byteLength, input.maximumWrite);
                chunks.push(chunk.subarray(0, bytesWritten));
                events.push(`write:${bytesWritten}`);
                return { bytesWritten };
            },
            async close() {
                events.push('close');
                if (input.closeFailure !== null) {
                    throw input.closeFailure;
                }
            }
        }
    };
}

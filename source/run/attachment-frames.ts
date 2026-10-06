import { Transform } from 'node:stream';

const newlineByte = 10;
export function boundedAttachmentFrames(limit: number): Transform {
    let pendingBytes = 0;
    return new Transform({
        transform(chunk: Buffer, encoding, callback) {
            if (typeof chunk === 'string') {
                callback(new TypeError(`Attachment messages require bytes, received ${encoding}.`));
                return;
            }
            for (const byte of chunk) {
                pendingBytes = byte === newlineByte ? 0 : pendingBytes + 1;
                if (pendingBytes > limit) {
                    callback(new Error('Attachment message exceeded its frame limit.'));
                    return;
                }
            }
            callback(null, chunk);
        }
    });
}

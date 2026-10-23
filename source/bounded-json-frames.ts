import { Transform } from 'node:stream';

const newlineByte = 10;

function createJsonFrameCheck(limit: number, context: string): (chunk: unknown) => Error | Uint8Array {
    let pendingBytes = 0;
    return function checkFrameBytes(chunk) {
        if (!(chunk instanceof Uint8Array)) {
            return new TypeError(`${context} messages require bytes.`);
        }
        for (const byte of chunk) {
            pendingBytes = byte === newlineByte ? 0 : pendingBytes + 1;
            if (pendingBytes > limit) {
                return new Error(`${context} message exceeded its frame limit.`);
            }
        }
        return chunk;
    };
}

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

export function createJsonFrameLimiter(limit: number, context: string): Transform {
    const check = createJsonFrameCheck(limit, context);
    return new Transform({
        transform(chunk: unknown, _encoding, complete) {
            const checked = check(chunk);
            if (checked instanceof Error) {
                complete(checked);
            } else {
                complete(null, checked);
            }
        }
    });
}

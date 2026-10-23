const newlineByte = 10;

export function createJsonFrameCheck(limit: number, context: string): (chunk: unknown) => Error | Uint8Array {
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

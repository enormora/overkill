const newlineByte = 10;

export function boundedJsonFrames(limit: number, context: string): TransformStream<Uint8Array, Uint8Array> {
    let pendingBytes = 0;
    return new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk: unknown, controller) {
            if (!(chunk instanceof Uint8Array)) {
                throw new TypeError(`${context} messages require bytes.`);
            }
            for (const byte of chunk) {
                pendingBytes = byte === newlineByte ? 0 : pendingBytes + 1;
                if (pendingBytes > limit) {
                    throw new Error(`${context} message exceeded its frame limit.`);
                }
            }
            controller.enqueue(chunk);
        }
    });
}

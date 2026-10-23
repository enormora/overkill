import { createJsonFrameCheck } from './json-frame-check.ts';

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

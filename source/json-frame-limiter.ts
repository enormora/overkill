import { createJsonFrameCheck } from './json-frame-check.ts';

type JsonFrameTransform = (
    chunk: unknown,
    encoding: string,
    complete: (error: Error | null, data: Uint8Array | undefined) => void
) => void;

export function createJsonFrameLimiter(limit: number, context: string): JsonFrameTransform {
    const check = createJsonFrameCheck(limit, context);
    return function limitFrameBytes(chunk, _encoding, complete) {
        const checked = check(chunk);
        if (checked instanceof Error) {
            complete(checked, undefined);
        } else {
            complete(null, checked);
        }
    };
}

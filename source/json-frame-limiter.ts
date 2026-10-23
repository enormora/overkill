import { Transform } from 'node:stream';
import { createJsonFrameCheck } from './json-frame-check.ts';

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

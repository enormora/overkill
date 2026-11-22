import { Transform } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { defineMacro, suite, test } from '@overkill-dev/test';

import { boundedJsonFrames } from './packages/resources/attachment-context.entry-point.ts';
import { createJsonFrameLimiter } from './json-frame-limiter.ts';

const assertRejectedWebFrame = defineMacro(function (title: string, chunks: readonly unknown[], message: string) {
    return test(title, async function (scope) {
        const frames = boundedJsonFrames(3, 'JSON');
        const reading = Array.fromAsync(frames.readable);
        const writer = frames.writable.getWriter();
        const rejected = scope.assert.rejects(async function writeInvalidFrame() {
            for (const chunk of chunks) {
                await Reflect.apply(writer.write, writer, [ chunk ]);
            }
        }, { message });
        const settled = Promise.allSettled([ reading, writer.closed ]);
        await rejected;
        await settled;
        writer.releaseLock();

        return scope.assert.collect();
    });
});

export const testNode = suite('bounded JSON frames', [
    test('Web frames count bytes across chunks and reset at newlines', async function (scope) {
        const frames = boundedJsonFrames(3, 'JSON');
        const reading = Array.fromAsync(frames.readable);
        const writer = frames.writable.getWriter();
        await writer.write(Buffer.from('ab'));
        await writer.write(Buffer.from('c\nabc\n'));
        await writer.close();
        scope.assert.equal(Buffer.concat(await reading).toString(), 'abc\nabc\n');
        writer.releaseLock();
        return scope.assert.collect();
    }),
    assertRejectedWebFrame('Web frames reject non-byte values', [ 'invalid' ], 'JSON messages require bytes.'),
    assertRejectedWebFrame(
        'Web frames reject oversized frames across chunks',
        [ Buffer.from('abc'), Buffer.from('d') ],
        'JSON message exceeded its frame limit.'
    ),
    test('frame limiters retain chunks and reset at newlines', async function (scope) {
        const frames = new Transform({ transform: createJsonFrameLimiter(3, 'JSON') });
        const reading = buffer(frames);
        frames.write(Buffer.from('ab'));
        frames.end(Buffer.from('c\nabc\n'));
        const bytes = await reading;
        scope.assert.equal(bytes.toString(), 'abc\nabc\n');
        return scope.assert.collect();
    }),
    test('frame limiters reject oversized frames across chunks', async function (scope) {
        const frames = new Transform({ transform: createJsonFrameLimiter(3, 'JSON') });
        const rejected = scope.assert.rejects(async function readOversizedFrame() {
            await buffer(frames);
        }, { message: 'JSON message exceeded its frame limit.' });
        frames.write(Buffer.from('abc'));
        frames.end(Buffer.from('d'));
        await rejected;
        return scope.assert.collect();
    })
]);

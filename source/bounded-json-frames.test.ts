import { buffer } from 'node:stream/consumers';
import { suite, test, type TestScope } from './packages/test/test.entry-point.ts';
import { boundedJsonFrames } from './bounded-json-frames.ts';
import { createJsonFrameLimiter } from './json-frame-limiter.ts';

async function assertRejectedWebFrame(scope: TestScope, chunks: readonly unknown[], message: string): Promise<void> {
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
}

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
    test('Web frames reject non-byte values', async function (scope) {
        await assertRejectedWebFrame(scope, [ 'invalid' ], 'JSON messages require bytes.');
        return scope.assert.collect();
    }),
    test('Web frames reject oversized frames across chunks', async function (scope) {
        await assertRejectedWebFrame(
            scope,
            [ Buffer.from('abc'), Buffer.from('d') ],
            'JSON message exceeded its frame limit.'
        );
        return scope.assert.collect();
    }),
    test('frame limiters retain chunks and reset at newlines', async function (scope) {
        const frames = createJsonFrameLimiter(3, 'JSON');
        const reading = buffer(frames);
        frames.write(Buffer.from('ab'));
        frames.end(Buffer.from('c\nabc\n'));
        const bytes = await reading;
        scope.assert.equal(bytes.toString(), 'abc\nabc\n');
        return scope.assert.collect();
    }),
    test('frame limiters reject oversized frames across chunks', async function (scope) {
        const frames = createJsonFrameLimiter(3, 'JSON');
        const rejected = scope.assert.rejects(async function readOversizedFrame() {
            await buffer(frames);
        }, { message: 'JSON message exceeded its frame limit.' });
        frames.write(Buffer.from('abc'));
        frames.end(Buffer.from('d'));
        await rejected;
        return scope.assert.collect();
    })
]);

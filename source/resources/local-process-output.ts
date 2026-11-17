import { StringDecoder } from 'node:string_decoder';
import type { FailureArtifactStream } from '../attachments/failure-artifact-stream.ts';

export type LocalProcessOutputBuffer = {
    readonly bytes: () => Uint8Array;
    readonly text: () => string;
};

export type LocalProcessOutput = {
    readonly stderr: LocalProcessOutputBuffer;
    readonly stdout: LocalProcessOutputBuffer;
};

export type LocalProcessOutputWriters = {
    readonly appendStderr: (chunk: Uint8Array) => void;
    readonly appendStdout: (chunk: Uint8Array) => void;
    readonly finishStderr: () => void;
    readonly finishStdout: () => void;
    readonly output: LocalProcessOutput;
};

type BoundedOutputBufferController = {
    readonly append: (chunk: Uint8Array) => void;
    readonly buffer: LocalProcessOutputBuffer;
};

function createBoundedOutputBuffer(maxBytes: number): BoundedOutputBufferController {
    let value = Buffer.alloc(0);

    return {
        append(chunk) {
            value = Buffer.concat([ value, chunk ]);

            if (value.byteLength > maxBytes) {
                value = value.subarray(value.byteLength - maxBytes);
            }
        },
        buffer: Object.freeze({
            bytes() {
                return new Uint8Array(value);
            },
            text() {
                return value.toString('utf8');
            }
        })
    };
}

export function createLocalProcessOutput(
    maxBytes: number,
    captures: Readonly<Record<'stderr' | 'stdout', FailureArtifactStream | null>>
): LocalProcessOutputWriters {
    const stdout = createBoundedOutputBuffer(maxBytes);
    const stderr = createBoundedOutputBuffer(maxBytes);
    const stdoutDecoder = new StringDecoder();
    const stderrDecoder = new StringDecoder();

    return {
        appendStderr(chunk) {
            stderr.append(chunk);
            captures.stderr?.write(stderrDecoder.write(chunk));
        },
        appendStdout(chunk) {
            stdout.append(chunk);
            captures.stdout?.write(stdoutDecoder.write(chunk));
        },
        finishStderr() {
            const tail = stderrDecoder.end();
            if (tail.length > 0) {
                captures.stderr?.write(tail);
            }
        },
        finishStdout() {
            const tail = stdoutDecoder.end();
            if (tail.length > 0) {
                captures.stdout?.write(tail);
            }
        },
        output: Object.freeze({
            stderr: stderr.buffer,
            stdout: stdout.buffer
        })
    };
}

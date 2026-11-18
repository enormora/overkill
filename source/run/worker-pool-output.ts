import type { Clock } from '@enormora/clock';
import {
    defineReporter,
    type DefinedReporter
} from '../engine/reporter.ts';
import type {
    WorkerPoolMessage,
    WorkerTask as WorkerPoolTask
} from './worker-pool-protocol.ts';

type WorkerPoolStreamName = 'stderr' | 'stdout';

type RestoredOutputCapture = {
    readonly restore: () => void;
};

type StreamWrite = typeof process.stdout.write;
export type WorkerOutputStreams = Readonly<Record<WorkerPoolStreamName, { readonly write: StreamWrite; }>>;
export type WorkerOutputTask = { readonly port: Pick<WorkerPoolTask['port'], 'postMessage'>; };
type WriteCallback = (error?: Error | null) => void;
type WriteChunk = Uint8Array | string;
type WriteEncodingOrCallback = WriteCallback | string;

function ignoredLine(): void {
    return undefined;
}

function outputBuffer(chunk: WriteChunk): Buffer {
    return Buffer.from(chunk);
}

function replaceStreamWrite(
    streams: WorkerOutputStreams,
    streamName: WorkerPoolStreamName,
    write: StreamWrite
): () => void {
    const stream = streams[streamName];
    const originalWrite = stream.write.bind(stream);
    Object.assign(stream, { write });

    return function restoreStream() {
        Object.assign(stream, { write: originalWrite });
    };
}

function invokeWriteCallbacks(
    encodingOrCallback: WriteEncodingOrCallback | undefined,
    callback: WriteCallback | undefined
): void {
    if (typeof encodingOrCallback === 'function') {
        encodingOrCallback(null);
    }

    callback?.(null);
}

function captureStream(
    streams: WorkerOutputStreams,
    streamName: WorkerPoolStreamName,
    task: WorkerOutputTask,
    wallClock: Clock
): () => void {
    function writeCapturedOutput(chunk: WriteChunk, callback?: WriteCallback): boolean;
    function writeCapturedOutput(
        chunk: WriteChunk,
        encoding?: string,
        callback?: WriteCallback
    ): boolean;
    function writeCapturedOutput(
        chunk: WriteChunk,
        encodingOrCallback?: WriteEncodingOrCallback,
        callback?: WriteCallback
    ): boolean {
        const output: WorkerPoolMessage = {
            capturedAtMicroseconds: Number(wallClock.currentMonotonicMicroseconds),
            chunk: outputBuffer(chunk),
            kind: 'output',
            stream: streamName
        };

        task.port.postMessage(output, []);
        invokeWriteCallbacks(encodingOrCallback, callback);

        return true;
    }

    return replaceStreamWrite(streams, streamName, writeCapturedOutput);
}

function suppressStream(streams: WorkerOutputStreams, streamName: WorkerPoolStreamName): () => void {
    function writeSuppressedOutput(_chunk: WriteChunk, callback?: WriteCallback): boolean;
    function writeSuppressedOutput(
        _chunk: WriteChunk,
        encoding?: string,
        callback?: WriteCallback
    ): boolean;
    function writeSuppressedOutput(
        _chunk: WriteChunk,
        encodingOrCallback?: WriteEncodingOrCallback,
        callback?: WriteCallback
    ): boolean {
        invokeWriteCallbacks(encodingOrCallback, callback);

        return true;
    }

    return replaceStreamWrite(streams, streamName, writeSuppressedOutput);
}

export type WorkerOutputCapture = {
    readonly captureOutput: (task: WorkerOutputTask, wallClock: Clock) => RestoredOutputCapture;
    readonly suppressOutput: () => RestoredOutputCapture;
};
export function createWorkerOutputCapture(streams: WorkerOutputStreams): WorkerOutputCapture {
    return {
        captureOutput(task: WorkerOutputTask, wallClock: Clock): RestoredOutputCapture {
            const restoreStdout = captureStream(streams, 'stdout', task, wallClock);
            const restoreStderr = captureStream(streams, 'stderr', task, wallClock);
            return {
                restore() {
                    restoreStdout();
                    restoreStderr();
                }
            };
        },
        suppressOutput(): RestoredOutputCapture {
            const restoreStdout = suppressStream(streams, 'stdout');
            const restoreStderr = suppressStream(streams, 'stderr');
            return {
                restore() {
                    restoreStdout();
                    restoreStderr();
                }
            };
        }
    };
}

export const { captureOutput, suppressOutput } = createWorkerOutputCapture({
    stdout: process.stdout,
    stderr: process.stderr
});

export function createWorkerPoolReporter(task: WorkerOutputTask): DefinedReporter {
    return defineReporter(function createWorkerPoolRuntimeReporter() {
        return {
            dispose: null,
            kind: 'real-time',
            name: 'worker-pool-thread',
            onEvent(event) {
                if (event.kind !== 'run-start' && event.kind !== 'run-end') {
                    const message: WorkerPoolMessage = { event, kind: 'event' };
                    task.port.postMessage(message, []);
                }
            },
            onFinish: null,
            sinks: [ { kind: 'memory' } ]
        };
    });
}

export const silentOutputSinks = {
    stderr: { writeLine: ignoredLine },
    stdout: { writeLine: ignoredLine }
};

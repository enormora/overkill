import type { createWallClock } from '@enormora/wall-clock';
import {
    defineReporter,
    type DefinedReporter
} from '../packages/engine/engine.entry-point.ts';
import type {
    WorkerPoolMessage,
    WorkerPoolTask
} from './worker-pool-protocol.ts';

type WorkerPoolStreamName = 'stderr' | 'stdout';

type RestoredOutputCapture = {
    readonly restore: () => void;
};

type StreamWrite = typeof process.stdout.write;
type WriteCallback = (error?: Error | null) => void;
type WriteChunk = Uint8Array | string;
type WriteEncodingOrCallback = WriteCallback | string;

function ignoredLine(): void {
    return undefined;
}

function outputBuffer(chunk: WriteChunk): Buffer {
    return Buffer.from(chunk);
}

function selectedStream(streamName: WorkerPoolStreamName): typeof process.stderr | typeof process.stdout {
    return streamName === 'stdout' ? process.stdout : process.stderr;
}

function replaceStreamWrite(streamName: WorkerPoolStreamName, write: StreamWrite): () => void {
    const stream = selectedStream(streamName);
    const originalWrite = stream.write.bind(stream);
    stream.write = write;

    return function restoreStream() {
        stream.write = originalWrite;
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
    streamName: WorkerPoolStreamName,
    task: WorkerPoolTask,
    wallClock: ReturnType<typeof createWallClock>
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
            capturedAtMilliseconds: wallClock.currentTimestampInMilliseconds,
            chunk: outputBuffer(chunk),
            kind: 'output',
            stream: streamName
        };

        task.port.postMessage(output, []);
        invokeWriteCallbacks(encodingOrCallback, callback);

        return true;
    }

    return replaceStreamWrite(streamName, writeCapturedOutput);
}

export function captureOutput(
    task: WorkerPoolTask,
    wallClock: ReturnType<typeof createWallClock>
): RestoredOutputCapture {
    const restoreStdout = captureStream('stdout', task, wallClock);
    const restoreStderr = captureStream('stderr', task, wallClock);

    return {
        restore() {
            restoreStdout();
            restoreStderr();
        }
    };
}

function suppressStream(streamName: WorkerPoolStreamName): () => void {
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

    return replaceStreamWrite(streamName, writeSuppressedOutput);
}

export function suppressOutput(): RestoredOutputCapture {
    const restoreStdout = suppressStream('stdout');
    const restoreStderr = suppressStream('stderr');

    return {
        restore() {
            restoreStdout();
            restoreStderr();
        }
    };
}

export function createWorkerPoolReporter(task: WorkerPoolTask): DefinedReporter {
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

import { createStoredValue, type StoredValue } from '../stored-value.ts';
import type { ProcessMarker } from './process-script.ts';
import type { ProcessObservation } from './process-observation.ts';

type MarkerWindow = 'readiness' | 'response' | 'script';
type MarkerWaiter = {
    readonly marker: Buffer;
    readonly start: number;
    readonly consume: boolean;
    readonly resolve: (time: bigint) => void;
    readonly reject: (error: Error) => void;
};
type CapturedOutput = { readonly text: string; readonly bytes: number; readonly truncated: boolean; };
type OutputCapture = {
    readonly bytes: StoredValue<number>;
    readonly retained: StoredValue<Buffer>;
    readonly history: StoredValue<Buffer>;
    readonly base: StoredValue<number>;
    readonly cursor: StoredValue<number>;
    readonly failure: StoredValue<Error | null>;
    readonly waiters: Readonly<Set<MarkerWaiter>>;
};
export type ProcessOutput = {
    readonly append: (stream: ProcessMarker['stream'], chunk: Buffer) => void;
    readonly expect: (marker: ProcessMarker, window: MarkerWindow) => Promise<bigint>;
    readonly finish: (error: Error) => void;
    readonly snapshot: () => ProcessObservation['output'];
    readonly firstOutput: () => bigint | null;
};
const matchingWindowBytes = 1_048_576;

function createCapture(): OutputCapture {
    return {
        bytes: createStoredValue(0),
        retained: createStoredValue<Buffer>(Buffer.alloc(0)),
        history: createStoredValue<Buffer>(Buffer.alloc(0)),
        base: createStoredValue(0),
        cursor: createStoredValue(0),
        failure: createStoredValue<Error | null>(null),
        waiters: new Set()
    };
}

function captureMatches(capture: OutputCapture, waiter: MarkerWaiter): boolean {
    const offset = capture.history.read().indexOf(waiter.marker, Math.max(0, waiter.start - capture.base.read()));
    if (offset === -1) {
        return false;
    }
    if (waiter.consume) {
        capture.cursor.write(capture.base.read() + offset + waiter.marker.length);
    }
    waiter.resolve(process.hrtime.bigint());
    return true;
}

function resolveMarkers(capture: OutputCapture): void {
    for (const waiter of capture.waiters) {
        if (captureMatches(capture, waiter)) {
            capture.waiters.delete(waiter);
        }
    }
}

function trimHistory(capture: OutputCapture): void {
    const removed = Math.max(0, capture.history.read().length - matchingWindowBytes);
    capture.history.write(capture.history.read().subarray(removed));
    capture.base.write(capture.base.read() + removed);
}

function appendCapture(capture: OutputCapture, chunk: Buffer, available: number): number {
    const retained = chunk.subarray(0, Math.max(0, available));
    capture.retained.write(Buffer.concat([ capture.retained.read(), retained ]));
    capture.bytes.write(capture.bytes.read() + chunk.length);
    capture.history.write(Buffer.concat([ capture.history.read(), chunk ]));
    resolveMarkers(capture);
    trimHistory(capture);
    return retained.length;
}

function markerStart(capture: OutputCapture, window: MarkerWindow): number {
    if (window === 'response') {
        return capture.bytes.read();
    }
    return window === 'script' ? capture.cursor.read() : 0;
}

async function expectMarker(capture: OutputCapture, text: string, window: MarkerWindow): Promise<bigint> {
    return await new Promise<bigint>(function (resolve, reject) {
        const failure = capture.failure.read();
        if (failure !== null) {
            reject(failure);
            return;
        }
        const waiter: MarkerWaiter = {
            marker: Buffer.from(text),
            start: markerStart(capture, window),
            consume: window !== 'readiness',
            resolve,
            reject
        };
        if (!captureMatches(capture, waiter)) {
            capture.waiters.add(waiter);
        }
    });
}

function finishCapture(capture: OutputCapture, error: Error): void {
    capture.failure.write(error);
    for (const waiter of capture.waiters) {
        waiter.reject(error);
    }
    capture.waiters.clear();
}

function capturedOutput(capture: OutputCapture): CapturedOutput {
    const decoder = new TextDecoder();
    const retained = capture.retained.read();
    return {
        text: decoder.decode(retained, { stream: capture.bytes.read() > retained.length }),
        bytes: capture.bytes.read(),
        truncated: capture.bytes.read() > retained.length
    };
}

export function processOutput(kind: 'pipes' | 'pty', maximumBytes: number): ProcessOutput {
    const streams = { stdout: createCapture(), stderr: createCapture(), terminal: createCapture() };
    let retained = 0;
    let first: bigint | null = null;
    return {
        append(name, chunk) {
            if (chunk.length > 0 && first === null) {
                first = process.hrtime.bigint();
            }
            retained += appendCapture(streams[name], chunk, maximumBytes - retained);
        },
        async expect(marker, window) {
            return await expectMarker(streams[marker.stream], marker.text, window);
        },
        finish(error) {
            for (const stream of Object.values(streams)) {
                finishCapture(stream, error);
            }
        },
        firstOutput() {
            return first;
        },
        snapshot() {
            return kind === 'pipes'
                ? { kind: 'pipes', stdout: capturedOutput(streams.stdout), stderr: capturedOutput(streams.stderr) }
                : { kind: 'terminal', terminal: capturedOutput(streams.terminal) };
        }
    };
}

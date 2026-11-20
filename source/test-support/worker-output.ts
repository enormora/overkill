import { Writable } from 'node:stream';
import { type DeterministicClock, createDeterministicClock } from '@enormora/clock';

import {
    type WorkerOutputCapture,
    type WorkerOutputTask,
    createWorkerOutputCapture
} from '../run/worker-pool-output.ts';
import type { TestScope } from '@overkill-dev/test';

function nativeOutput(record: (text: string) => void): Writable {
    return new Writable({
        write(chunk: Buffer, _encoding, callback) {
            record(chunk.toString());
            callback();
        }
    });
}
type WorkerOutputFixture = {
    readonly streams: { readonly stdout: Writable; readonly stderr: Writable; };
    readonly stdout: readonly string[];
    readonly stderr: readonly string[];
    readonly task: WorkerOutputTask;
    readonly messages: readonly unknown[];
    readonly clock: DeterministicClock;
    readonly capture: WorkerOutputCapture;
};
export function workerOutput(scope: TestScope): WorkerOutputFixture {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const streams = {
        stdout: nativeOutput(function (text) {
            stdout.push(text);
        }),
        stderr: nativeOutput(function (text) {
            stderr.push(text);
        })
    };
    const messages: unknown[] = [];
    const task = {
        port: {
            postMessage(message: unknown) {
                messages.push(message);
            }
        }
    };
    scope.cleanup(function () {
        streams.stdout.destroy();
        streams.stderr.destroy();
    });
    return {
        streams,
        stdout,
        stderr,
        task,
        messages,
        clock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n }),
        capture: createWorkerOutputCapture(streams)
    };
}

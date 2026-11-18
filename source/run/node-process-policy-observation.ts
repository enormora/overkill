import { writeSync } from 'node:fs';
import { formatCaseId } from '../engine/identity.ts';
import type { RunnerError } from '../engine/run-result.ts';

type ProcessListener = (event: string | symbol, listener: (message: unknown) => void) => void;
type ProcessEvents = {
    readonly on: (event: 'newListener', listener: ProcessListener) => unknown;
    readonly removeListener: (event: 'newListener', listener: ProcessListener) => unknown;
};

export function observeProcessIpcListeners(
    processObject: ProcessEvents,
    record: (message: string) => void,
    ownedListeners: Readonly<WeakSet<(message: unknown) => void>>
): () => void {
    function observeListener(event: string | symbol, listener: (message: unknown) => void): void {
        if (event === 'message' && !ownedListeners.has(listener)) {
            try {
                record('Runtime policy violation: process message listener was registered.');
            } catch {
            }
        }
    }

    processObject.on('newListener', observeListener);

    return function stopObservingIpcListeners(): void {
        processObject.removeListener('newListener', observeListener);
    };
}

export type ProcessExitRuntime = {
    readonly listen: (listener: (code: number) => void) => void;
    readonly remove: (listener: (code: number) => void) => void;
    readonly fail: () => void;
    readonly write: (bytes: Uint8Array) => void;
};
export function createProcessExitObserver(
    runtime: ProcessExitRuntime
): (record: (message: string) => RunnerError) => () => void {
    const exitDiagnosticLimit = 4096;
    function writeExitDiagnostic(record: (message: string) => RunnerError): void {
        const error = record('Runtime policy violation: process exited before restricted execution completed.');
        const attribution = error.attributedTo === null ? '' : ` Case: ${formatCaseId(error.attributedTo)}.`;
        const attempt = error.attributedToAttempt === null ? '' : ` Attempt: ${error.attributedToAttempt.index}.`;
        runtime.write(
            Buffer.from(`${error.message}${attribution}${attempt}\n`).subarray(0, exitDiagnosticLimit)
        );
    }

    return function observeProcessExit(
        record: (message: string) => RunnerError
    ): () => void {
        function reportPrematureExit(code: number): void {
            if (code === 0) {
                runtime.fail();
            }

            try {
                writeExitDiagnostic(record);
            } catch {
            }
        }

        runtime.listen(reportPrematureExit);

        return function stopObservingProcessExit(): void {
            runtime.remove(reportPrematureExit);
        };
    };
}
const stderrDescriptor = 2;
export const observeProcessExit = createProcessExitObserver({
    listen(listener) {
        process.on('exit', listener);
    },
    remove(listener) {
        process.removeListener('exit', listener);
    },
    fail() {
        process.exitCode = 1;
    },
    write(bytes) {
        // eslint-disable-next-line node/no-sync -- Exit listeners cannot flush asynchronous writes.
        writeSync(stderrDescriptor, bytes);
    }
});

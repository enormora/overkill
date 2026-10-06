import { writeSync } from 'node:fs';
import { formatCaseId } from '../engine/identity.ts';
import type { RunnerError } from '../engine/run-result.ts';

type ProcessEvents = Pick<typeof process, 'on' | 'removeListener'>;

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

const stderrDescriptor = 2;
const exitDiagnosticLimit = 4096;
function writeExitDiagnostic(record: (message: string) => RunnerError): void {
    const error = record('Runtime policy violation: process exited before restricted execution completed.');
    const attribution = error.attributedTo === null ? '' : ` Case: ${formatCaseId(error.attributedTo)}.`;
    const attempt = error.attributedToAttempt === null ? '' : ` Attempt: ${error.attributedToAttempt.index}.`;
    // eslint-disable-next-line node/no-sync -- Exit listeners cannot flush asynchronous writes.
    writeSync(
        stderrDescriptor,
        Buffer.from(`${error.message}${attribution}${attempt}\n`).subarray(0, exitDiagnosticLimit)
    );
}

export function observeProcessExit(
    record: (message: string) => RunnerError
): () => void {
    function reportPrematureExit(code: number): void {
        if (code === 0) {
            process.exitCode = 1;
        }

        try {
            writeExitDiagnostic(record);
        } catch {
        }
    }

    process.on('exit', reportPrematureExit);

    return function stopObservingProcessExit(): void {
        process.removeListener('exit', reportPrematureExit);
    };
}

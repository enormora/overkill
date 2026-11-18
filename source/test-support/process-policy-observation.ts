import { EventEmitter } from 'node:events';
import { createProcessExitObserver, observeProcessIpcListeners } from '../run/node-process-policy-observation.ts';
import { observationError } from './observation-lifetime.ts';

type ProcessPolicyFixture = {
    readonly events: EventEmitter;
    readonly messages: readonly string[];
    readonly writes: readonly string[];
    readonly failed: () => boolean;
    readonly stopExit: () => void;
    readonly stopIpc: () => void;
    readonly owned: (message: unknown) => void;
};
export function processPolicyObservation(failure: Error | null, attributed: boolean): ProcessPolicyFixture {
    const events = new EventEmitter();
    const messages: string[] = [];
    const writes: string[] = [];
    let failed = false;
    const observe = createProcessExitObserver({
        listen(listener) {
            events.on('exit', listener);
        },
        remove(listener) {
            events.removeListener('exit', listener);
        },
        fail() {
            failed = true;
        },
        write(bytes) {
            writes.push(Buffer.from(bytes).toString());
        }
    });
    const owned = function (): void {
        return undefined;
    };
    const listeners = new WeakSet([ owned ]);
    function record(message: string): void {
        if (failure !== null) {
            throw failure;
        }
        messages.push(message);
    }
    return {
        events,
        messages,
        writes,
        owned,
        failed() {
            return failed;
        },
        stopIpc: observeProcessIpcListeners(events, record, listeners),
        stopExit: observe(function (message) {
            record(message);
            const error = observationError();
            return attributed
                ? {
                    ...error,
                    attributedTo: { file: null, suite: [], params: null, title: 'active case' },
                    attributedToAttempt: { index: 2 }
                }
                : error;
        })
    };
}

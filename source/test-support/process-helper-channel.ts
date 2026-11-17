import { EventEmitter } from 'node:events';
import { createStoredValue } from '../stored-value.ts';
import type { ProcessHelperChild } from '../bench/process-helper.ts';
import type { ProcessHelperRequest } from '../bench/process-protocol.ts';

export type ProcessHelperFaults = {
    readonly send: Error | null;
    readonly group: Error | null;
    readonly shutdown: Error | null;
};
export const reliableProcessHelper: ProcessHelperFaults = { send: null, group: null, shutdown: null };
export type ProcessHelperChannel = {
    readonly child: ProcessHelperChild;
    readonly events: EventEmitter;
    readonly stderr: EventEmitter;
    readonly sent: readonly ProcessHelperRequest[];
    readonly killed: readonly string[];
    readonly close: (code: number | null, signal: string | null) => void;
};
export function processHelperChannel(faults: ProcessHelperFaults): ProcessHelperChannel {
    const events = new EventEmitter();
    const stderr = new EventEmitter();
    const connected = createStoredValue(true);
    const sent: ProcessHelperRequest[] = [];
    const killed: string[] = [];
    function close(code: number | null, signal: string | null): void {
        if (connected.read()) {
            connected.write(false);
            events.emit('close', code, signal);
        }
    }
    return {
        events,
        stderr,
        sent,
        killed,
        close,
        child: {
            get connected() {
                return connected.read();
            },
            stderr,
            on: events.on.bind(events),
            send(message, callback) {
                sent.push(message);
                callback(faults.send);
                if (message.kind === 'close' && faults.shutdown === null) {
                    close(0, null);
                }
                return true;
            },
            kill(signal) {
                killed.push(signal);
                close(null, signal);
                return true;
            }
        }
    };
}

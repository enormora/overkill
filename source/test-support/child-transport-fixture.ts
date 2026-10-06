import { EventEmitter } from 'node:events';
import { createDeterministicClock, type Clock } from '@enormora/clock';
import type { SupervisedChildProcess } from '../run/supervised-child-process.ts';
import {
    createStoredRunValue,
    createSupervisedRunState,
    type SupervisedRunState,
    type StoredRunValue
} from '../run/supervised-run-state.ts';
import { observeSupervisedTransport } from '../run/supervised-child-transport.ts';
import type { SupervisedChildMessage } from '../run/supervised-protocol.ts';

type TransportOutcome = {
    readonly closed: number;
    readonly finished: number;
    readonly signals: readonly string[];
};
export type ChildTransportFixture = {
    readonly child: SupervisedChildProcess;
    readonly clock: Clock & { readonly advanceByMilliseconds: (milliseconds: number) => unknown; };
    readonly emit: (event: string, value: unknown) => void;
    readonly messages: readonly SupervisedChildMessage[];
    readonly state: SupervisedRunState;
    readonly terminalFailure: StoredRunValue<boolean>;
    readonly outcome: () => TransportOutcome;
};
export function createChildTransportFixture(restricted: boolean): ChildTransportFixture {
    const events = new EventEmitter();
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const state = createSupervisedRunState('first-failure-and-final');
    const terminalFailure = createStoredRunValue(false);
    const messages: SupervisedChildMessage[] = [];
    const lifecycle = {
        closed: 0,
        completed: false,
        finished: 0,
        signals: [] as string[],
        exitCode: createStoredRunValue<number | null>(null)
    };
    const child: SupervisedChildProcess = {
        closeTransport() {
            lifecycle.closed += 1;
        },
        get exitCode() {
            return lifecycle.exitCode.read();
        },
        signalCode: null,
        pid: 1,
        kill(signal) {
            lifecycle.signals.push(signal);
        },
        on(...registration) {
            const [ event, listener ] = registration;
            events.on(event, listener);
        },
        send() {
            return undefined;
        },
        stdout: null,
        stderr: null
    };
    observeSupervisedTransport({
        child,
        state,
        terminalFailure,
        wallClock: clock,
        restricted,
        accept() {
            return !lifecycle.completed;
        },
        completed() {
            return lifecycle.completed;
        },
        finished() {
            lifecycle.finished += 1;
        },
        interrupted() {
            return undefined;
        },
        receive(message) {
            messages.push(message);
            lifecycle.completed = message.kind === 'result';
        }
    });
    return {
        child,
        clock,
        state,
        messages,
        terminalFailure,
        emit(event, value) {
            if (event === 'exit') {
                lifecycle.exitCode.write(0);
            }
            events.emit(event, value);
        },
        outcome() {
            return { closed: lifecycle.closed, finished: lifecycle.finished, signals: lifecycle.signals };
        }
    };
}

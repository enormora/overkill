import type { SupervisedChildProcess } from '../run/supervised-child-process.ts';
import { childProcessEnvelope, envelopeMessage } from '../run/child-process-protocol.ts';
import { workerPoolHostCommandSchema } from '../run/worker-pool-host-protocol-schema.ts';
import {
    workerPoolHostCorrelationId,
    type WorkerPoolHostCommand,
    type WorkerPoolHostMessage
} from '../run/worker-pool-host-protocol.ts';

type ChildOutput = NonNullable<SupervisedChildProcess['stdout']> & {
    readonly emit: (text: string) => void;
};

export type FakeHostChild = SupervisedChildProcess & {
    readonly emitError: (error: Error) => void;
    readonly emitExit: () => void;
    readonly emitMessage: (message: WorkerPoolHostMessage) => void;
    readonly sentCommands: () => readonly WorkerPoolHostCommand[];
    readonly stderr: ChildOutput;
    readonly stdout: ChildOutput;
};

function createChildOutput(): ChildOutput {
    let dataListener: (chunk: Uint8Array) => void = function ignoreOutput() {
        return undefined;
    };

    return {
        emit(text) {
            dataListener(Buffer.from(text));
        },
        on(_event, listener) {
            dataListener = listener;
        }
    };
}

export function createFakeHostChild(): FakeHostChild {
    const commands: WorkerPoolHostCommand[] = [];
    const errorListeners: ((error: Error) => void)[] = [];
    const exitListeners: (() => void)[] = [];
    const messageListeners: ((message: unknown) => void)[] = [];
    const stdout = createChildOutput();
    const stderr = createChildOutput();

    function emitMessage(message: WorkerPoolHostMessage): void {
        for (const listener of messageListeners) {
            listener(childProcessEnvelope(workerPoolHostCorrelationId, message));
        }
    }

    return {
        emitError(error) {
            for (const listener of errorListeners) {
                listener(error);
            }
        },
        emitExit() {
            for (const listener of exitListeners) {
                listener();
            }
        },
        emitMessage,
        closeTransport() {
            return undefined;
        },
        exitCode: null,
        kill() {
            return true;
        },
        on(...registration) {
            const [ event, listener ] = registration;

            if (event === 'error') {
                errorListeners.push(listener);
            } else if (event === 'exit' || event === 'close') {
                exitListeners.push(listener);
            } else if (event === 'message') {
                messageListeners.push(listener);
            }
        },
        pid: 12,
        send(message) {
            const command = envelopeMessage(message, workerPoolHostCorrelationId, workerPoolHostCommandSchema);

            if (command === null) {
                return false;
            }

            commands.push(command);

            if (command.kind === 'configure') {
                emitMessage({ kind: 'configured' });
            } else if (command.kind === 'destroy') {
                emitMessage({ kind: 'destroyed' });
                for (const listener of exitListeners) {
                    listener();
                }
            }

            return true;
        },
        sentCommands() {
            return commands;
        },
        signalCode: null,
        stderr,
        stdout
    };
}

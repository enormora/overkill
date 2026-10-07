import { createClock } from '@enormora/clock';
import { envelopeMessage, childProcessEnvelope } from './child-process-protocol.ts';
import { observeChildShutdown, startChildShutdown } from './child-process-shutdown.ts';
import { kill, type SupervisedChildProcess } from './supervised-child-process.ts';
import {
    workerPoolHostCorrelationId,
    type WorkerPoolHostMessage,
    type WorkerPoolHostCommand
} from './worker-pool-host-protocol.ts';
import { workerPoolHostMessageSchema, workerPoolHostCommandSchema } from './worker-pool-host-protocol-schema.ts';

type HostTransport = {
    readonly child: SupervisedChildProcess;
    readonly configured: () => void;
    readonly failed: (error: Error) => void;
    readonly finished: () => void;
    readonly hasTask: (taskId: string) => boolean;
    readonly receive: (message: WorkerPoolHostMessage) => void;
};

type HostObserver = {
    readonly fail: (error: Error) => void;
    readonly receive: (message: unknown) => void;
    readonly disconnect: () => void;
    readonly exit: () => void;
};
function hasTaskIdentity(
    message: WorkerPoolHostMessage
): message is Extract<WorkerPoolHostMessage, { readonly taskId: string; }> {
    return Object.hasOwn(message, 'taskId');
}
function validHostMessage(
    message: WorkerPoolHostMessage,
    configured: boolean,
    hasTask: (taskId: string) => boolean
): boolean {
    if (message.kind === 'configured') {
        return !configured;
    }
    return !hasTaskIdentity(message) || configured && hasTask(message.taskId);
}
function successfulExit(child: SupervisedChildProcess): boolean {
    return (child.exitCode === null || child.exitCode === 0) && child.signalCode === null;
}
function createHostObserver(transport: HostTransport): HostObserver {
    let configured = false;
    let destroyed = false;
    let failed = false;
    function fail(error: Error): void {
        if (!failed) {
            failed = true;
            transport.failed(error);
            kill(transport.child);
        }
    }

    function deliver(message: WorkerPoolHostMessage): void {
        if (destroyed || !validHostMessage(message, configured, transport.hasTask)) {
            fail(new Error('Invalid hosted worker-pool IPC lifecycle.'));
            return;
        }
        if (message.kind === 'configured') {
            configured = true;
            transport.configured();
        } else if (message.kind === 'destroyed') {
            destroyed = true;
            startChildShutdown(transport.child);
        } else {
            transport.receive(message);
        }
    }
    function receiveValidatedMessage(message: unknown): void {
        const decoded = envelopeMessage(message, workerPoolHostCorrelationId, workerPoolHostMessageSchema);
        if (decoded !== null) {
            deliver(decoded);
        }
    }
    return {
        fail,
        receive(message: unknown): void {
            if (failed) {
                return;
            }
            try {
                receiveValidatedMessage(message);
            } catch (error: unknown) {
                fail(error instanceof Error ? error : new Error('Invalid hosted worker-pool IPC payload.'));
            }
        },
        disconnect(): void {
            if (!destroyed) {
                fail(new Error('Hosted worker-pool disconnected before destruction acknowledgement.'));
            }
        },
        exit(): void {
            if (!destroyed || !successfulExit(transport.child)) {
                fail(new Error('Hosted worker-pool exited before successful shutdown.'));
            }
        }
    };
}

export function observeHostTransport(transport: HostTransport): void {
    const observer = createHostObserver(transport);
    transport.child.on('message', observer.receive);
    transport.child.on('error', observer.fail);
    transport.child.on('disconnect', observer.disconnect);
    observeChildShutdown(transport.child, createClock(), function reportShutdownTimeout() {
        observer.fail(new Error('Hosted worker-pool shutdown exceeded one second.'));
    }, function finishAfterDraining() {
        observer.exit();
        transport.finished();
    });
}

export function readHostCommand(message: unknown): WorkerPoolHostCommand | null {
    return envelopeMessage(message, workerPoolHostCorrelationId, workerPoolHostCommandSchema);
}

export function sendHostCommand(child: SupervisedChildProcess, command: WorkerPoolHostCommand): void {
    child.send(childProcessEnvelope(workerPoolHostCorrelationId, command));
}

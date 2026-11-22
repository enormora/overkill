import { supervisedCancellationSchema, supervisedParentMessageSchema } from './supervised-parent-message-schema.ts';
import { createChildProcessOutbox } from './child-process-outbox.ts';
import {
    envelopeMessage
} from './child-process-protocol.ts';
import {
    supervisedChildCorrelationId,
    supervisedCancellationCorrelationId,
    type SupervisedAssignmentCommand,
    type SupervisedChildCommand
} from './supervised-protocol.ts';
import type { SupervisedChildHost } from './supervised-child.ts';

const cancellation = new AbortController();
export const cancellationSignal: AbortSignal = cancellation.signal;
function cancelAnalysis(message: unknown): void {
    if (envelopeMessage(message, supervisedCancellationCorrelationId, supervisedCancellationSchema) !== null) {
        cancellation.abort(new DOMException('Supervised analysis cancelled.', 'AbortError'));
    }
}
export const ownedMessageListeners = new WeakSet<(message: unknown) => void>();

const outbox = createChildProcessOutbox(supervisedChildCorrelationId, {
    disconnect: process.disconnect?.bind(process) ?? null,
    send: process.send?.bind(process) ?? null
});

export function send(message: Parameters<SupervisedChildHost['send']>[0]): void {
    outbox.send(message);
}

export async function disconnect(): Promise<void> {
    await outbox.disconnect();
}

function supervisedParentMessage(message: unknown): SupervisedAssignmentCommand | SupervisedChildCommand | null {
    return envelopeMessage(message, supervisedChildCorrelationId, supervisedParentMessageSchema);
}

function readCommand(message: unknown): SupervisedChildCommand {
    const decoded = supervisedParentMessage(message);
    if (decoded !== null && decoded.kind !== 'assign') {
        return decoded;
    }
    throw new Error('Expected a supervised child command.');
}
function readAssignment(message: unknown): SupervisedAssignmentCommand {
    const decoded = supervisedParentMessage(message);
    if (decoded?.kind === 'assign') {
        return decoded;
    }
    throw new Error('Expected a supervised child assignment.');
}
async function receiveParentMessage<Message>(read: (message: unknown) => Message): Promise<Message> {
    return new Promise(function waitForParentMessage(resolve, reject) {
        const listener = function receiveMessage(message: unknown): void {
            if (envelopeMessage(message, supervisedCancellationCorrelationId, supervisedCancellationSchema) !== null) {
                return;
            }
            process.off('message', listener);
            try {
                resolve(read(message));
            } catch (error: unknown) {
                reject(error instanceof Error ? error : new Error('Invalid parent IPC payload.'));
            }
        };
        ownedMessageListeners.add(listener);
        process.on('message', listener);
    });
}
export async function receiveCommand(): Promise<SupervisedChildCommand> {
    return receiveParentMessage(readCommand);
}
export async function receiveAssignment(): Promise<SupervisedAssignmentCommand> {
    return receiveParentMessage(readAssignment);
}

export const flushSupervisedMessages = outbox.flush;

export function observeAnalysisCancellation(): () => void {
    ownedMessageListeners.add(cancelAnalysis);
    process.on('message', cancelAnalysis);
    return function stopObserving() {
        process.off('message', cancelAnalysis);
    };
}

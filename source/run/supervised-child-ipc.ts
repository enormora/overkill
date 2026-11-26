import { supervisedCancellationSchema, supervisedParentMessageSchema } from './supervised-parent-message-schema.ts';
import { createChildProcessOutbox } from './child-process-outbox.ts';
import { analysisCollectionFingerprint, envelopeMessage } from './child-process-protocol.ts';
import {
    assignedAnalysisCollection,
    supervisedChildCorrelationId,
    supervisedCancellationCorrelationId,
    type SupervisedAssignmentCommand,
    type SupervisedChildCommand,
    type SupervisedWorkCommand,
    type SupervisedParentMessage,
    type CollectSupervisedAnalysis
} from './supervised-protocol.ts';
import type { SupervisedChildHost } from './supervised-child.ts';
import type { CollectedFamilyMetadata } from './family-catalog.ts';

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

type ChildMessage = Parameters<SupervisedChildHost['send']>[0];

function sharesPreparation(
    checkpoint: NonNullable<CollectedFamilyMetadata['definition']['checkpoint']>,
    facts: CollectedFamilyMetadata['facts']
): boolean {
    const { preparation } = checkpoint;
    return preparation.id === facts.id && preparation.version === facts.version &&
        Object.is(preparation.settings, facts.settings) && Object.is(preparation.preparation, facts.preparation);
}

function encodeCollectedPreparation(message: ChildMessage): unknown {
    if (message.kind !== 'collected') {
        return message;
    }
    const { collectedPlan } = message;
    const { family } = collectedPlan;
    if (family === null || family.definition.checkpoint === null) {
        return message;
    }
    const { checkpoint } = family.definition;
    if (!sharesPreparation(checkpoint, family.facts)) {
        return message;
    }
    return {
        ...message,
        collectedPlan: {
            ...collectedPlan,
            family: {
                ...family,
                definition: { ...family.definition, checkpoint: { ...checkpoint, preparation: 'family-facts' } }
            }
        }
    };
}

export function send(message: ChildMessage): void {
    outbox.send(encodeCollectedPreparation(message));
}

export async function disconnect(): Promise<void> {
    await outbox.disconnect();
}

function supervisedParentMessage(message: unknown): SupervisedParentMessage | null {
    return envelopeMessage(message, supervisedChildCorrelationId, supervisedParentMessageSchema);
}

function readCommand(message: unknown): SupervisedChildCommand {
    const decoded = supervisedParentMessage(message);
    if (decoded !== null && decoded.kind !== 'assign' && decoded.kind !== 'select-analysis') {
        return decoded;
    }
    throw new Error('Expected a supervised child command.');
}
function readAssignment(message: unknown): SupervisedWorkCommand {
    const decoded = supervisedParentMessage(message);
    if (decoded?.kind === 'assign' || decoded?.kind === 'select-analysis') {
        return decoded;
    }
    throw new Error('Expected a supervised child assignment.');
}
async function receiveParentMessage<Message>(read: (message: unknown) => Message): Promise<Message> {
    if (!process.connected) {
        throw new Error('Supervised parent disconnected.');
    }
    return new Promise(function waitForParentMessage(resolve, reject) {
        const listeners = {
            disconnected: function loseParent() {
                process.off('message', listeners.message);
                reject(new Error('Supervised parent disconnected.'));
            },
            message: function receiveMessage(message: unknown) {
                if (
                    envelopeMessage(message, supervisedCancellationCorrelationId, supervisedCancellationSchema) !== null
                ) {
                    return;
                }
                process.off('message', listeners.message);
                process.off('disconnect', listeners.disconnected);
                try {
                    resolve(read(message));
                } catch (error: unknown) {
                    reject(error instanceof Error ? error : new Error('Invalid parent IPC payload.'));
                }
            }
        };
        ownedMessageListeners.add(listeners.message);
        process.on('message', listeners.message);
        process.once('disconnect', listeners.disconnected);
    });
}
export async function receiveCommand(): Promise<SupervisedChildCommand> {
    return receiveParentMessage(readCommand);
}
function acknowledgeAnalysisCollection(
    assignment: SupervisedWorkCommand,
    collection: Awaited<ReturnType<CollectSupervisedAnalysis>>
): SupervisedAssignmentCommand {
    if (assignment.kind !== 'assign') {
        throw new Error('Expected an assignment after collecting analysis.');
    }
    if (assignedAnalysisCollection(assignment) !== analysisCollectionFingerprint(collection)) {
        throw new TypeError('Frozen analysis assignment changed; collect a new run.');
    }
    return { ...assignment, analysisCollection: collection };
}

export async function receiveAssignment(collect: CollectSupervisedAnalysis): Promise<SupervisedAssignmentCommand> {
    const message = await receiveParentMessage(readAssignment);
    if (message.kind === 'assign') {
        return message;
    }
    const collection = await collect(message.workIds);
    send({ kind: 'analysis-collected', collection });
    const assignment = await receiveParentMessage(readAssignment);
    return acknowledgeAnalysisCollection(assignment, collection);
}

export const flushSupervisedMessages = outbox.flush;

export function observeAnalysisCancellation(): () => void {
    ownedMessageListeners.add(cancelAnalysis);
    process.on('message', cancelAnalysis);
    return function stopObserving() {
        process.off('message', cancelAnalysis);
    };
}

import type {
    LinearizabilityEvent,
    LinearizabilityObservation,
    LinearizabilityOutcome
} from './linearizability-definition.ts';

export type RecordedOperation<Operation, Output> = {
    readonly id: string;
    readonly invocation: number;
    readonly response: number;
    readonly observation: Readonly<LinearizabilityObservation<Operation, Output>>;
};

function snapshotOutcome<Output>(outcome: LinearizabilityOutcome<Output>): LinearizabilityOutcome<Output> {
    return outcome.kind === 'returned'
        ? Object.freeze({ kind: 'returned', value: outcome.value })
        : Object.freeze({ kind: 'threw', error: outcome.error });
}

function recordEvent<Operation, Output>(
    previous: RecordedOperation<Operation, Output> | undefined,
    event: LinearizabilityEvent<Operation, Output>,
    position: number
): RecordedOperation<Operation, Output> {
    if (event.kind === 'invoke') {
        if (previous !== undefined) {
            throw new TypeError('Duplicate invocation ID.');
        }
        return Object.freeze({
            id: event.id,
            invocation: position,
            response: Number.POSITIVE_INFINITY,
            observation: Object.freeze({ operation: event.operation, outcome: Object.freeze({ kind: 'pending' }) })
        });
    }
    if (previous?.response !== Number.POSITIVE_INFINITY) {
        throw new TypeError('Response requires an unmatched invocation.');
    }
    return Object.freeze({
        ...previous,
        response: position,
        observation: Object.freeze({
            operation: previous.observation.operation,
            outcome: snapshotOutcome(event.outcome)
        })
    });
}

export function linearizabilityHistory<Operation, Output>(
    history: readonly LinearizabilityEvent<Operation, Output>[]
): readonly RecordedOperation<Operation, Output>[] {
    const operations = new Map<string, RecordedOperation<Operation, Output>>();
    for (const [ position, event ] of history.entries()) {
        operations.set(event.id, recordEvent(operations.get(event.id), event, position));
    }
    return Object.freeze(Array.from(operations.values()));
}

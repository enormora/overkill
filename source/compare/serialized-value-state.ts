import type {
    SerializationBudget,
    SerializationTruncation,
    SerializedValue
} from './serialized-value-shape.ts';

const nextReferenceIndex = 0;
const serializedBytesIndex = 1;
const visitedNodesIndex = 2;

export type SerializationState = {
    readonly budget: SerializationBudget;
    readonly counters: Int32Array;
    readonly seen: WeakMap<WeakKey, number>;
};

function counterValue(state: SerializationState, index: number): number {
    return state.counters[index] ?? 0;
}

function setCounterValue(state: SerializationState, index: number, value: number): void {
    const { counters } = state;

    counters[index] = value;
}

export function nextReferenceId(state: SerializationState): number {
    return counterValue(state, nextReferenceIndex);
}

export function truncation(reason: SerializationTruncation['reason'], budget: number): SerializationTruncation {
    return { budget, reason };
}

export function createState(budget: SerializationBudget): SerializationState {
    return {
        budget,
        counters: Int32Array.from([ 1, 0, 0 ]),
        seen: new WeakMap<WeakKey, number>()
    };
}

function estimatedBytes(value: SerializedValue): number {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function accountValue(state: SerializationState, value: SerializedValue): SerializedValue {
    const visitedNodes = counterValue(state, visitedNodesIndex) + 1;

    setCounterValue(state, visitedNodesIndex, visitedNodes);

    if (visitedNodes > state.budget.visitedNodes) {
        return {
            kind: 'unavailable',
            reason: `visited node budget reached: ${state.budget.visitedNodes}`
        };
    }

    const serializedBytes = counterValue(state, serializedBytesIndex) + estimatedBytes(value);

    setCounterValue(state, serializedBytesIndex, serializedBytes);

    return serializedBytes > state.budget.operandBytes
        ? {
            kind: 'unavailable',
            reason: `serialized byte budget reached: ${state.budget.operandBytes}`
        }
        : value;
}

export function referenceFor(state: SerializationState, value: WeakKey): number | null {
    const existing = state.seen.get(value);

    if (existing !== undefined) {
        return existing;
    }

    const nextReference = counterValue(state, nextReferenceIndex);

    state.seen.set(value, nextReference);
    setCounterValue(state, nextReferenceIndex, nextReference + 1);

    return null;
}

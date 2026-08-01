import type {
    DoubleCall,
    DoubleConstruction,
    DoubleInteraction,
    DoubleIteratorEvent,
    DoubleResult
} from './double-history-record.ts';

export type HistoryStore = {
    readonly callIndex: () => number;
    readonly calls: readonly DoubleCall[];
    readonly constructionIndex: () => number;
    readonly constructions: readonly DoubleConstruction[];
    readonly currentRecordingGeneration: () => number;
    readonly interactionOrder: () => number;
    readonly interactions: readonly DoubleInteraction[];
    readonly iteratorEventIndex: () => number;
    readonly iteratorEvents: readonly DoubleIteratorEvent[];
    readonly iteratorIndex: () => number;
    readonly recordingEnabled: (generation: number) => boolean;
    readonly recordCall: (call: DoubleCall) => void;
    readonly recordConstruction: (construction: DoubleConstruction) => void;
    readonly recordIteratorEvent: (event: DoubleIteratorEvent) => void;
    readonly reset: () => void;
    readonly results: readonly DoubleResult[];
};

type HistoryRecords = {
    readonly calls: readonly DoubleCall[];
    readonly constructions: readonly DoubleConstruction[];
    readonly interactions: readonly DoubleInteraction[];
    readonly iteratorEvents: readonly DoubleIteratorEvent[];
    readonly recordCall: (call: DoubleCall) => void;
    readonly recordConstruction: (construction: DoubleConstruction) => void;
    readonly recordIteratorEvent: (event: DoubleIteratorEvent) => void;
    readonly reset: () => void;
    readonly results: readonly DoubleResult[];
};

type HistoryIndex = {
    readonly next: () => number;
    readonly reset: () => void;
};

type RecordingGeneration = {
    readonly current: () => number;
    readonly enabled: (candidate: number) => boolean;
    readonly next: () => void;
};

function createHistoryRecords(): HistoryRecords {
    const calls: DoubleCall[] = [];
    const constructions: DoubleConstruction[] = [];
    const interactions: DoubleInteraction[] = [];
    const iteratorEvents: DoubleIteratorEvent[] = [];
    const results: DoubleResult[] = [];

    return {
        calls,
        constructions,
        interactions,
        iteratorEvents,
        recordCall(call: DoubleCall) {
            calls.push(call);
            interactions.push(call);
            results.push(call.result);
        },
        recordConstruction(construction: DoubleConstruction) {
            constructions.push(construction);
            interactions.push(construction);
            results.push(construction.result);
        },
        recordIteratorEvent(event: DoubleIteratorEvent) {
            iteratorEvents.push(event);
        },
        reset() {
            calls.length = 0;
            constructions.length = 0;
            interactions.length = 0;
            iteratorEvents.length = 0;
            results.length = 0;
        },
        results
    };
}

function createHistoryIndex(): HistoryIndex {
    let next = 0;

    return {
        next() {
            const index = next;
            next += 1;
            return index;
        },
        reset() {
            next = 0;
        }
    };
}

function createRecordingGeneration(): RecordingGeneration {
    let generation = 0;

    return {
        current() {
            return generation;
        },
        enabled(candidate: number) {
            return candidate === generation;
        },
        next() {
            generation += 1;
        }
    };
}

export function createHistoryStore(resetRuntimeState: () => void): HistoryStore {
    const records = createHistoryRecords();
    const callIndex = createHistoryIndex();
    const constructionIndex = createHistoryIndex();
    const interactionOrder = createHistoryIndex();
    const iteratorEventIndex = createHistoryIndex();
    const iteratorIndex = createHistoryIndex();
    const recordingGeneration = createRecordingGeneration();

    return {
        callIndex() {
            return callIndex.next();
        },
        calls: records.calls,
        constructionIndex() {
            return constructionIndex.next();
        },
        constructions: records.constructions,
        currentRecordingGeneration() {
            return recordingGeneration.current();
        },
        interactionOrder() {
            return interactionOrder.next();
        },
        interactions: records.interactions,
        iteratorEventIndex() {
            return iteratorEventIndex.next();
        },
        iteratorEvents: records.iteratorEvents,
        iteratorIndex() {
            return iteratorIndex.next();
        },
        recordingEnabled(candidate) {
            return recordingGeneration.enabled(candidate);
        },
        recordCall(call) {
            records.recordCall(call);
        },
        recordConstruction(construction) {
            records.recordConstruction(construction);
        },
        recordIteratorEvent(event) {
            records.recordIteratorEvent(event);
        },
        reset() {
            records.reset();
            callIndex.reset();
            constructionIndex.reset();
            interactionOrder.reset();
            iteratorEventIndex.reset();
            iteratorIndex.reset();
            recordingGeneration.next();
            resetRuntimeState();
        },
        results: records.results
    };
}

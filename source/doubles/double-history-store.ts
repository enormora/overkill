import type {
    DoubleCall,
    DoubleConstruction,
    DoubleInteraction,
    DoubleResult
} from './double-history-record.ts';

export type HistoryStore = {
    readonly callIndex: () => number;
    readonly calls: readonly DoubleCall[];
    readonly constructionIndex: () => number;
    readonly constructions: readonly DoubleConstruction[];
    readonly interactionOrder: () => number;
    readonly interactions: readonly DoubleInteraction[];
    readonly recordCall: (call: DoubleCall) => void;
    readonly recordConstruction: (construction: DoubleConstruction) => void;
    readonly reset: () => void;
    readonly results: readonly DoubleResult[];
};

export function createHistoryStore(resetRuntimeState: () => void): HistoryStore {
    const calls: DoubleCall[] = [];
    const constructions: DoubleConstruction[] = [];
    const interactions: DoubleInteraction[] = [];
    const results: DoubleResult[] = [];
    let nextCallIndex = 0;
    let nextConstructionIndex = 0;
    let nextOrder = 0;

    return {
        callIndex() {
            const index = nextCallIndex;
            nextCallIndex += 1;
            return index;
        },
        calls,
        constructionIndex() {
            const index = nextConstructionIndex;
            nextConstructionIndex += 1;
            return index;
        },
        constructions,
        interactionOrder() {
            const order = nextOrder;
            nextOrder += 1;
            return order;
        },
        interactions,
        recordCall(call) {
            calls.push(call);
            interactions.push(call);
            results.push(call.result);
        },
        recordConstruction(construction) {
            constructions.push(construction);
            interactions.push(construction);
            results.push(construction.result);
        },
        reset() {
            calls.length = 0;
            constructions.length = 0;
            interactions.length = 0;
            results.length = 0;
            nextCallIndex = 0;
            nextConstructionIndex = 0;
            nextOrder = 0;
            resetRuntimeState();
        },
        results
    };
}

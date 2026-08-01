import {
    copyCall,
    copyConstruction,
    copyInteraction,
    copyIteratorEvent,
    copyResult,
    type DoubleCall,
    type DoubleConstruction,
    type DoubleInteraction,
    type DoubleIteratorEvent,
    type DoubleResult
} from './double-history-record.ts';
import type { HistoryStore } from './double-history-store.ts';

type UnknownFunctionTarget = (...arguments_: readonly unknown[]) => unknown;

export type MutableDoubleHistory = {
    readonly callCount: number;
    readonly calls: readonly DoubleCall[];
    readonly constructionCount: number;
    readonly constructions: readonly DoubleConstruction[];
    readonly firstCall: DoubleCall | null;
    readonly firstConstruction: DoubleConstruction | null;
    readonly firstInteraction: DoubleInteraction | null;
    readonly firstIteratorEvent: DoubleIteratorEvent | null;
    readonly firstResult: DoubleResult | null;
    readonly interactionCount: number;
    readonly interactions: readonly DoubleInteraction[];
    readonly iteratorEventCount: number;
    readonly iteratorEvents: readonly DoubleIteratorEvent[];
    readonly lastCall: DoubleCall | null;
    readonly lastConstruction: DoubleConstruction | null;
    readonly lastInteraction: DoubleInteraction | null;
    readonly lastIteratorEvent: DoubleIteratorEvent | null;
    readonly lastResult: DoubleResult | null;
    readonly nthCall: (index: number) => DoubleCall | null;
    readonly nthConstruction: (index: number) => DoubleConstruction | null;
    readonly nthInteraction: (index: number) => DoubleInteraction | null;
    readonly nthIteratorEvent: (index: number) => DoubleIteratorEvent | null;
    readonly reset: () => void;
    readonly results: readonly DoubleResult[];
};

const historyPropertyNames: readonly (keyof MutableDoubleHistory)[] = [
    'callCount',
    'calls',
    'constructionCount',
    'constructions',
    'firstCall',
    'firstConstruction',
    'firstInteraction',
    'firstIteratorEvent',
    'firstResult',
    'interactionCount',
    'interactions',
    'iteratorEventCount',
    'iteratorEvents',
    'lastCall',
    'lastConstruction',
    'lastInteraction',
    'lastIteratorEvent',
    'lastResult',
    'nthCall',
    'nthConstruction',
    'nthInteraction',
    'nthIteratorEvent',
    'reset',
    'results'
];

function copyNullable<Item>(item: Item | null, copy: (value: Item) => Item): Item | null {
    return item === null ? null : copy(item);
}

function validHistoryIndex(index: number): boolean {
    return Number.isSafeInteger(index) && index >= 0;
}

export function createHistoryApi(store: HistoryStore): MutableDoubleHistory {
    return {
        get callCount() {
            return store.calls.length;
        },
        get calls() {
            return store.calls.map(copyCall);
        },
        get constructionCount() {
            return store.constructions.length;
        },
        get constructions() {
            return store.constructions.map(copyConstruction);
        },
        get firstCall() {
            return copyNullable(store.calls[0] ?? null, copyCall);
        },
        get firstConstruction() {
            return copyNullable(store.constructions[0] ?? null, copyConstruction);
        },
        get firstInteraction() {
            return copyNullable(store.interactions[0] ?? null, copyInteraction);
        },
        get firstIteratorEvent() {
            return copyNullable(store.iteratorEvents[0] ?? null, copyIteratorEvent);
        },
        get firstResult() {
            return copyNullable(store.results[0] ?? null, copyResult);
        },
        get interactionCount() {
            return store.interactions.length;
        },
        get interactions() {
            return store.interactions.map(copyInteraction);
        },
        get iteratorEventCount() {
            return store.iteratorEvents.length;
        },
        get iteratorEvents() {
            return store.iteratorEvents.map(copyIteratorEvent);
        },
        get lastCall() {
            return copyNullable(store.calls.at(-1) ?? null, copyCall);
        },
        get lastConstruction() {
            return copyNullable(store.constructions.at(-1) ?? null, copyConstruction);
        },
        get lastInteraction() {
            return copyNullable(store.interactions.at(-1) ?? null, copyInteraction);
        },
        get lastIteratorEvent() {
            return copyNullable(store.iteratorEvents.at(-1) ?? null, copyIteratorEvent);
        },
        get lastResult() {
            return copyNullable(store.results.at(-1) ?? null, copyResult);
        },
        nthCall(index) {
            return validHistoryIndex(index) ? copyNullable(store.calls[index] ?? null, copyCall) : null;
        },
        nthConstruction(index) {
            return validHistoryIndex(index) ? copyNullable(store.constructions[index] ?? null, copyConstruction) : null;
        },
        nthInteraction(index) {
            return validHistoryIndex(index) ? copyNullable(store.interactions[index] ?? null, copyInteraction) : null;
        },
        nthIteratorEvent(index) {
            return validHistoryIndex(index)
                ? copyNullable(store.iteratorEvents[index] ?? null, copyIteratorEvent)
                : null;
        },
        reset: store.reset,
        get results() {
            return store.results.map(copyResult);
        }
    };
}

function defineHistoryProperty(
    target: UnknownFunctionTarget,
    api: MutableDoubleHistory,
    name: keyof MutableDoubleHistory
): void {
    const descriptor = Object.getOwnPropertyDescriptor(api, name);

    if (descriptor === undefined) {
        throw new TypeError(`test double history property ${name} is not defined.`);
    }

    Object.defineProperty(target, name, {
        ...descriptor,
        enumerable: false
    });
}

export function installHistory(target: UnknownFunctionTarget, api: MutableDoubleHistory): void {
    for (const name of historyPropertyNames) {
        defineHistoryProperty(target, api, name);
    }
}

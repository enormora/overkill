import type { ConstructorReturnValue, InvocationKind } from './double-behavior.ts';

export type DoubleReturnedResult<Value = unknown> = {
    readonly invocationIndex: number;
    readonly invocationKind: InvocationKind;
    readonly order: number;
    readonly status: 'returned';
    readonly value: Value;
};

export type DoubleThrownResult = {
    readonly invocationIndex: number;
    readonly invocationKind: InvocationKind;
    readonly order: number;
    readonly status: 'threw';
    readonly thrown: unknown;
};

export type DoubleResult<Value = unknown> = DoubleReturnedResult<Value> | DoubleThrownResult;

export type DoubleCall<
    Arguments extends readonly unknown[] = readonly unknown[],
    ReturnValue = unknown,
    ThisValue = unknown
> = {
    readonly arguments: Arguments;
    readonly index: number;
    readonly kind: 'call';
    readonly order: number;
    readonly result: DoubleResult<ReturnValue>;
    readonly thisValue: ThisValue;
};

export type DoubleConstruction<
    Arguments extends readonly unknown[] = readonly unknown[],
    Instance = unknown
> = {
    readonly arguments: Arguments;
    readonly index: number;
    readonly instance: Instance | null;
    readonly kind: 'construction';
    readonly order: number;
    readonly result: DoubleResult<Instance>;
};

export type DoubleInteraction<
    CallRecord extends DoubleCall = DoubleCall,
    ConstructionRecord extends DoubleConstruction = DoubleConstruction
> = CallRecord | ConstructionRecord;

type MutableDoubleHistory = {
    readonly callCount: number;
    readonly calls: readonly DoubleCall[];
    readonly constructionCount: number;
    readonly constructions: readonly DoubleConstruction[];
    readonly firstCall: DoubleCall | null;
    readonly firstConstruction: DoubleConstruction | null;
    readonly firstInteraction: DoubleInteraction | null;
    readonly firstResult: DoubleResult | null;
    readonly interactionCount: number;
    readonly interactions: readonly DoubleInteraction[];
    readonly lastCall: DoubleCall | null;
    readonly lastConstruction: DoubleConstruction | null;
    readonly lastInteraction: DoubleInteraction | null;
    readonly lastResult: DoubleResult | null;
    readonly nthCall: (index: number) => DoubleCall | null;
    readonly nthConstruction: (index: number) => DoubleConstruction | null;
    readonly nthInteraction: (index: number) => DoubleInteraction | null;
    readonly reset: () => void;
    readonly results: readonly DoubleResult[];
};

export type RuntimeDoubleHistory = {
    readonly callIndex: () => number;
    readonly constructionIndex: () => number;
    readonly install: (target: UnknownFunctionTarget) => void;
    readonly interactionOrder: () => number;
    readonly recordCallResult: (
        invocation: HistoryInvocation<'call'>,
        thisValue: unknown,
        result: DoubleResult
    ) => void;
    readonly recordConstructionResult: (
        invocation: HistoryInvocation<'construction'>,
        instance: ConstructorReturnValue | null,
        result: DoubleResult
    ) => void;
    readonly reset: () => void;
};

export type HistoryInvocation<Kind extends InvocationKind = InvocationKind> = {
    readonly arguments: readonly unknown[];
    readonly index: number;
    readonly kind: Kind;
    readonly order: number;
};

type UnknownFunctionTarget = (...arguments_: readonly unknown[]) => unknown;

type HistoryStore = {
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

const historyPropertyNames: readonly (keyof MutableDoubleHistory)[] = [
    'callCount',
    'calls',
    'constructionCount',
    'constructions',
    'firstCall',
    'firstConstruction',
    'firstInteraction',
    'firstResult',
    'interactionCount',
    'interactions',
    'lastCall',
    'lastConstruction',
    'lastInteraction',
    'lastResult',
    'nthCall',
    'nthConstruction',
    'nthInteraction',
    'reset',
    'results'
];

function copyResult(result: DoubleResult): DoubleResult {
    return { ...result };
}

function copyCall(call: DoubleCall): DoubleCall {
    return {
        ...call,
        arguments: Array.from(call.arguments),
        result: copyResult(call.result)
    };
}

function copyConstruction(construction: DoubleConstruction): DoubleConstruction {
    return {
        ...construction,
        arguments: Array.from(construction.arguments),
        result: copyResult(construction.result)
    };
}

function copyInteraction(interaction: DoubleInteraction): DoubleInteraction {
    return interaction.kind === 'call' ? copyCall(interaction) : copyConstruction(interaction);
}

function copyNullable<Item>(item: Item | null, copy: (value: Item) => Item): Item | null {
    return item === null ? null : copy(item);
}

function validHistoryIndex(index: number): boolean {
    return Number.isSafeInteger(index) && index >= 0;
}

export function createReturnedResult(invocation: HistoryInvocation, value: unknown): DoubleResult {
    return {
        invocationIndex: invocation.index,
        invocationKind: invocation.kind,
        order: invocation.order,
        status: 'returned',
        value
    };
}

export function createThrownResult(invocation: HistoryInvocation, thrown: unknown): DoubleResult {
    return {
        invocationIndex: invocation.index,
        invocationKind: invocation.kind,
        order: invocation.order,
        status: 'threw',
        thrown
    };
}

function createHistoryStore(resetRuntimeState: () => void): HistoryStore {
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

function createHistoryApi(store: HistoryStore): MutableDoubleHistory {
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
        get firstResult() {
            return copyNullable(store.results[0] ?? null, copyResult);
        },
        get interactionCount() {
            return store.interactions.length;
        },
        get interactions() {
            return store.interactions.map(copyInteraction);
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

function createCallRecord(
    invocation: HistoryInvocation<'call'>,
    thisValue: unknown,
    result: DoubleResult
): DoubleCall {
    return {
        arguments: Array.from(invocation.arguments),
        index: invocation.index,
        kind: 'call',
        order: invocation.order,
        result,
        thisValue
    };
}

function createConstructionRecord(
    invocation: HistoryInvocation<'construction'>,
    instance: ConstructorReturnValue | null,
    result: DoubleResult
): DoubleConstruction {
    return {
        arguments: Array.from(invocation.arguments),
        index: invocation.index,
        instance,
        kind: 'construction',
        order: invocation.order,
        result
    };
}

function installHistory(target: UnknownFunctionTarget, api: MutableDoubleHistory): void {
    for (const name of historyPropertyNames) {
        defineHistoryProperty(target, api, name);
    }
}

function createRuntimeHistory(store: HistoryStore, api: MutableDoubleHistory): RuntimeDoubleHistory {
    return {
        callIndex: store.callIndex,
        constructionIndex: store.constructionIndex,
        install(target) {
            installHistory(target, api);
        },
        interactionOrder: store.interactionOrder,
        recordCallResult(invocation, thisValue, result) {
            store.recordCall(createCallRecord(invocation, thisValue, result));
        },
        recordConstructionResult(invocation, instance, result) {
            store.recordConstruction(createConstructionRecord(invocation, instance, result));
        },
        reset: store.reset
    };
}

export function createDoubleHistory(resetRuntimeState: () => void): RuntimeDoubleHistory {
    const store = createHistoryStore(resetRuntimeState);

    return createRuntimeHistory(store, createHistoryApi(store));
}

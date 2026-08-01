import type {
    DoubleIteratorMethod,
    DoubleIteratorProtocol,
    HistoryInvocation
} from './double-history-record.ts';
import type { HistoryStore } from './double-history-store.ts';

export type SyncIteratorSource = () => Iterator<unknown, unknown, unknown>;
export type AsyncIteratorSource = () => AsyncIterator<unknown, unknown, unknown> | Iterator<unknown, unknown, unknown>;

export type TrackedCallInvocation = HistoryInvocation<'call'> | {
    readonly arguments: readonly unknown[];
    readonly index: number;
    readonly kind: 'call';
};

type IteratorRecordContext = {
    readonly generation: number;
    readonly invocation: TrackedCallInvocation;
    readonly iteratorIndex: number;
    readonly protocol: DoubleIteratorProtocol;
};

type IteratorRecordInput = {
    readonly context: IteratorRecordContext;
    readonly method: DoubleIteratorMethod;
    readonly parameters: readonly unknown[];
    readonly store: HistoryStore;
};

type IteratorResultRecordInput = IteratorRecordInput & {
    readonly result: IteratorResult<unknown, unknown>;
};

type IteratorThrowRecordInput = IteratorRecordInput & {
    readonly error: unknown;
};

function iteratorResultEventKind(result: IteratorResult<unknown, unknown>): 'return' | 'yield' {
    return result.done === true ? 'return' : 'yield';
}

function recordIteratorResult(input: IteratorResultRecordInput): void {
    if (!input.store.recordingEnabled(input.context.generation)) {
        return;
    }

    input.store.recordIteratorEvent({
        arguments: Array.from(input.parameters),
        callIndex: input.context.invocation.index,
        index: input.store.iteratorEventIndex(),
        iteratorIndex: input.context.iteratorIndex,
        kind: iteratorResultEventKind(input.result),
        method: input.method,
        protocol: input.context.protocol,
        value: input.result.value
    });
}

function recordIteratorThrow(input: IteratorThrowRecordInput): void {
    if (!input.store.recordingEnabled(input.context.generation)) {
        return;
    }

    input.store.recordIteratorEvent({
        arguments: Array.from(input.parameters),
        callIndex: input.context.invocation.index,
        index: input.store.iteratorEventIndex(),
        iteratorIndex: input.context.iteratorIndex,
        kind: 'throw',
        method: input.method,
        protocol: input.context.protocol,
        thrown: input.error
    });
}

function completedIteratorResult(value: unknown): IteratorResult<unknown, unknown> {
    return {
        done: true,
        value
    };
}

function cachedSource<Value>(source: () => Value): () => Value {
    let value: Value | null = null;

    return function currentValue() {
        if (value === null) {
            value = source();
        }

        return value;
    };
}

function syncIteratorMethod(
    iterator: Iterator<unknown, unknown, unknown>,
    method: DoubleIteratorMethod
): (...parameters: readonly unknown[]) => IteratorResult<unknown, unknown> {
    if (method === 'next') {
        return function callNext(...parameters: readonly unknown[]) {
            return iterator.next(parameters[0]);
        };
    }

    const methodValue = Reflect.get(iterator, method);

    if (typeof methodValue === 'function') {
        const invoke = methodValue.bind(iterator) as (
            ...parameters: readonly unknown[]
        ) => IteratorResult<unknown, unknown>;

        return function callIteratorMethod(...parameters: readonly unknown[]) {
            return invoke(...parameters);
        };
    }

    if (method === 'return') {
        return function returnWithoutIteratorMethod(...parameters: readonly unknown[]) {
            return completedIteratorResult(parameters[0]);
        };
    }

    return function throwWithoutIteratorMethod(...parameters: readonly unknown[]): never {
        throw parameters[0];
    };
}

function asyncIteratorMethod(
    iterator: AsyncIterator<unknown, unknown, unknown> | Iterator<unknown, unknown, unknown>,
    method: DoubleIteratorMethod
): (...parameters: readonly unknown[]) => Promise<IteratorResult<unknown, unknown>> {
    if (method === 'next') {
        return async function callNext(...parameters: readonly unknown[]) {
            return iterator.next(parameters[0]);
        };
    }

    const methodValue = Reflect.get(iterator, method);

    if (typeof methodValue === 'function') {
        const invoke = methodValue.bind(iterator) as (
            ...parameters: readonly unknown[]
        ) => IteratorResult<unknown, unknown> | Promise<IteratorResult<unknown, unknown>>;

        return async function callIteratorMethod(...parameters: readonly unknown[]) {
            return invoke(...parameters);
        };
    }

    if (method === 'return') {
        return async function returnWithoutAsyncIteratorMethod(...parameters: readonly unknown[]) {
            return completedIteratorResult(parameters[0]);
        };
    }

    return async function throwWithoutAsyncIteratorMethod(...parameters: readonly unknown[]): Promise<never> {
        throw parameters[0];
    };
}

function createIteratorContext(
    store: HistoryStore,
    invocation: TrackedCallInvocation,
    protocol: DoubleIteratorProtocol
): IteratorRecordContext {
    return {
        generation: store.currentRecordingGeneration(),
        invocation,
        iteratorIndex: store.iteratorIndex(),
        protocol
    };
}

export function createSyncTrackedIterator(
    store: HistoryStore,
    invocation: TrackedCallInvocation,
    source: SyncIteratorSource
): IterableIterator<unknown> {
    const currentIterator = cachedSource(source);
    const context = createIteratorContext(store, invocation, 'sync');

    function call(method: DoubleIteratorMethod, parameters: readonly unknown[]): IteratorResult<unknown, unknown> {
        try {
            const result = syncIteratorMethod(currentIterator(), method)(...parameters);
            recordIteratorResult({ context, method, parameters, result, store });
            return result;
        } catch (error: unknown) {
            recordIteratorThrow({ context, error, method, parameters, store });
            throw error;
        }
    }

    const tracked = {
        next(...parameters: readonly unknown[]) {
            return call('next', parameters);
        },
        return(...parameters: readonly unknown[]) {
            return call('return', parameters);
        },
        throw(...parameters: readonly unknown[]) {
            return call('throw', parameters);
        },
        [Symbol.iterator]() {
            return tracked;
        }
    };

    return tracked;
}

export function createAsyncTrackedIterator(
    store: HistoryStore,
    invocation: TrackedCallInvocation,
    source: AsyncIteratorSource
): AsyncIterableIterator<unknown> {
    const currentIterator = cachedSource(source);
    const context = createIteratorContext(store, invocation, 'async');

    async function call(
        method: DoubleIteratorMethod,
        parameters: readonly unknown[]
    ): Promise<IteratorResult<unknown, unknown>> {
        try {
            const result = await asyncIteratorMethod(currentIterator(), method)(...parameters);
            recordIteratorResult({ context, method, parameters, result, store });
            return result;
        } catch (error: unknown) {
            recordIteratorThrow({ context, error, method, parameters, store });
            throw error;
        }
    }

    const tracked = {
        async next(...parameters: readonly unknown[]) {
            return await call('next', parameters);
        },
        async return(...parameters: readonly unknown[]) {
            return await call('return', parameters);
        },
        async throw(...parameters: readonly unknown[]) {
            return await call('throw', parameters);
        },
        [Symbol.asyncIterator]() {
            return tracked;
        }
    };

    return tracked;
}

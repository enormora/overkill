import type {
    CallableSignature,
    UnknownFunction
} from './double-behavior.ts';
import type { DoubleIteratorEvent } from './double-history-record.ts';
import {
    installProtocolMetadata,
    protocolIteratorEvents
} from './protocol-double-metadata.ts';
import {
    testDouble,
    type TestDouble,
    type TestDoubleConfiguration
} from './test-double.ts';

type SyncNext<YieldValue, ReturnValue, _NextValue> = UnknownFunction<IteratorResult<YieldValue, ReturnValue>>;
type SyncReturn<YieldValue, ReturnValue> = UnknownFunction<IteratorResult<YieldValue, ReturnValue>>;
type SyncThrow<YieldValue, ReturnValue> = UnknownFunction<IteratorResult<YieldValue, ReturnValue>>;

type AsyncNext<YieldValue, ReturnValue, _NextValue> = UnknownFunction<Promise<IteratorResult<YieldValue, ReturnValue>>>;
type AsyncReturn<YieldValue, ReturnValue> = UnknownFunction<Promise<IteratorResult<YieldValue, ReturnValue>>>;
type AsyncThrow<YieldValue, ReturnValue> = UnknownFunction<Promise<IteratorResult<YieldValue, ReturnValue>>>;

export type ProtocolMethodConfiguration<Signature extends CallableSignature> = TestDoubleConfiguration<Signature>;

export type TestIterator<
    YieldValue = unknown,
    ReturnValue = unknown,
    NextValue = unknown
> = IteratorObject<YieldValue, ReturnValue, NextValue> & {
    readonly next: TestDouble<SyncNext<YieldValue, ReturnValue, NextValue>>;
    readonly return: TestDouble<SyncReturn<YieldValue, ReturnValue>>;
    readonly throw: TestDouble<SyncThrow<YieldValue, ReturnValue>>;
};

export type TestAsyncIterator<
    YieldValue = unknown,
    ReturnValue = unknown,
    NextValue = unknown
> = AsyncIterable<YieldValue> & AsyncIterator<YieldValue, ReturnValue, NextValue> & {
    readonly next: TestDouble<AsyncNext<YieldValue, ReturnValue, NextValue>>;
    readonly return: TestDouble<AsyncReturn<YieldValue, ReturnValue>>;
    readonly throw: TestDouble<AsyncThrow<YieldValue, ReturnValue>>;
};

export type TestIterable<
    YieldValue = unknown,
    ReturnValue = unknown,
    NextValue = unknown
> = Iterable<YieldValue> & {
    readonly [Symbol.iterator]: TestDouble<() => TestIterator<YieldValue, ReturnValue, NextValue>>;
};

export type TestAsyncIterable<
    YieldValue = unknown,
    ReturnValue = unknown,
    NextValue = unknown
> = AsyncIterable<YieldValue> & {
    readonly [Symbol.asyncIterator]: TestDouble<() => TestAsyncIterator<YieldValue, ReturnValue, NextValue>>;
};

export type TestDisposable = Disposable & {
    readonly [Symbol.dispose]: TestDouble<() => void>;
};

export type TestAsyncDisposable = AsyncDisposable & {
    readonly [Symbol.asyncDispose]: TestDouble<() => Promise<void>>;
};

type SyncIteratorConfiguration<YieldValue, ReturnValue, NextValue> = {
    readonly next: ProtocolMethodConfiguration<SyncNext<YieldValue, ReturnValue, NextValue>>;
    readonly return: ProtocolMethodConfiguration<SyncReturn<YieldValue, ReturnValue>>;
    readonly throw: ProtocolMethodConfiguration<SyncThrow<YieldValue, ReturnValue>>;
};

type AsyncIteratorConfiguration<YieldValue, ReturnValue, NextValue> = {
    readonly next: ProtocolMethodConfiguration<AsyncNext<YieldValue, ReturnValue, NextValue>>;
    readonly return: ProtocolMethodConfiguration<AsyncReturn<YieldValue, ReturnValue>>;
    readonly throw: ProtocolMethodConfiguration<AsyncThrow<YieldValue, ReturnValue>>;
};

type SyncIterableConfiguration<YieldValue, ReturnValue, NextValue> = {
    readonly iterator: ProtocolMethodConfiguration<() => TestIterator<YieldValue, ReturnValue, NextValue>>;
};

type AsyncIterableConfiguration<YieldValue, ReturnValue, NextValue> = {
    readonly asyncIterator: ProtocolMethodConfiguration<() => TestAsyncIterator<YieldValue, ReturnValue, NextValue>>;
};

type DisposableConfiguration = {
    readonly dispose: ProtocolMethodConfiguration<() => void>;
};

type AsyncDisposableConfiguration = {
    readonly asyncDispose: ProtocolMethodConfiguration<() => Promise<void>>;
};

type IteratorMethods<YieldValue, ReturnValue, NextValue> = {
    readonly next: TestDouble<SyncNext<YieldValue, ReturnValue, NextValue>>;
    readonly return: TestDouble<SyncReturn<YieldValue, ReturnValue>>;
    readonly throw: TestDouble<SyncThrow<YieldValue, ReturnValue>>;
};

type AsyncIteratorMethods<YieldValue, ReturnValue, NextValue> = {
    readonly next: TestDouble<AsyncNext<YieldValue, ReturnValue, NextValue>>;
    readonly return: TestDouble<AsyncReturn<YieldValue, ReturnValue>>;
    readonly throw: TestDouble<AsyncThrow<YieldValue, ReturnValue>>;
};

type IteratorEventInput = {
    readonly arguments: readonly unknown[];
    readonly iteratorIndex: number;
    readonly method: 'next' | 'return' | 'throw';
    readonly protocol: 'async' | 'sync';
    readonly result: IteratorResult<unknown, unknown>;
};

type IteratorThrowInput = {
    readonly arguments: readonly unknown[];
    readonly iteratorIndex: number;
    readonly method: 'next' | 'return' | 'throw';
    readonly protocol: 'async' | 'sync';
    readonly thrown: unknown;
};

type IteratorEventRecorder = {
    readonly events: () => readonly DoubleIteratorEvent[];
    readonly recordResult: (input: IteratorEventInput) => void;
    readonly recordThrow: (input: IteratorThrowInput) => void;
};

type SyncIteratorSource<YieldValue, ReturnValue, NextValue> =
    | Iterable<YieldValue> |
    Iterator<YieldValue, ReturnValue, NextValue>;

type AsyncIteratorSource<YieldValue, ReturnValue, NextValue> =
    | AsyncIterable<YieldValue> |
    AsyncIterator<YieldValue, ReturnValue, NextValue> |
    Iterable<YieldValue> |
    Iterator<YieldValue, ReturnValue, NextValue>;

function createIteratorEventRecorder(): IteratorEventRecorder {
    const events: DoubleIteratorEvent[] = [];

    return {
        events() {
            return events.map(function copyEvent(event) {
                return {
                    ...event,
                    arguments: Array.from(event.arguments)
                };
            });
        },
        recordResult(input) {
            events.push({
                arguments: Array.from(input.arguments),
                callIndex: 0,
                index: events.length,
                iteratorIndex: input.iteratorIndex,
                kind: input.result.done === true ? 'return' : 'yield',
                method: input.method,
                protocol: input.protocol,
                value: input.result.value
            });
        },
        recordThrow(input) {
            events.push({
                arguments: Array.from(input.arguments),
                callIndex: 0,
                index: events.length,
                iteratorIndex: input.iteratorIndex,
                kind: 'throw',
                method: input.method,
                protocol: input.protocol,
                thrown: input.thrown
            });
        }
    };
}

function configuredMethod<Signature extends CallableSignature>(
    configuration: ProtocolMethodConfiguration<Signature>
): TestDouble<Signature> {
    return testDouble(
        configuration as TestDoubleConfiguration<UnknownFunction<unknown>>
    ) as unknown as TestDouble<Signature>;
}

function returnedResult<Value>(value: Value): IteratorReturnResult<Value> {
    return {
        done: true,
        value
    };
}

function nextDone<YieldValue, ReturnValue>(): IteratorResult<YieldValue, ReturnValue> {
    return returnedResult(undefined as ReturnValue);
}

function syncReturnDefault<YieldValue, ReturnValue>(
    ...parameters: readonly [] | readonly [ReturnValue]
): IteratorResult<YieldValue, ReturnValue> {
    return returnedResult(parameters[0] as ReturnValue);
}

function syncThrowDefault<YieldValue, ReturnValue>(
    ...parameters: readonly [] | readonly [unknown]
): IteratorResult<YieldValue, ReturnValue> {
    throw parameters[0];
}

async function asyncNextDone<YieldValue, ReturnValue>(): Promise<IteratorResult<YieldValue, ReturnValue>> {
    return nextDone();
}

async function asyncReturnDefault<YieldValue, ReturnValue>(
    ...parameters: readonly [] | readonly [ReturnValue]
): Promise<IteratorResult<YieldValue, ReturnValue>> {
    return returnedResult(parameters[0] as ReturnValue);
}

async function asyncThrowDefault<YieldValue, ReturnValue>(
    ...parameters: readonly [] | readonly [unknown]
): Promise<IteratorResult<YieldValue, ReturnValue>> {
    throw parameters[0];
}

function resultValue(value: unknown): IteratorResult<unknown, unknown> {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, 'done')
        ? value as IteratorResult<unknown, unknown>
        : returnedResult(value);
}

function trackSyncMethod<Signature extends CallableSignature>(
    method: 'next' | 'return' | 'throw',
    target: TestDouble<Signature>,
    recorder: IteratorEventRecorder,
    iteratorIndex: number
): TestDouble<Signature> {
    return new Proxy(target, {
        apply(doubleTarget, thisArgument, argumentList): unknown {
            try {
                const result = Reflect.apply(doubleTarget, thisArgument, argumentList);
                recorder.recordResult({
                    arguments: Array.from(argumentList),
                    iteratorIndex,
                    method,
                    protocol: 'sync',
                    result: resultValue(result)
                });
                return result;
            } catch (error: unknown) {
                recorder.recordThrow({
                    arguments: Array.from(argumentList),
                    iteratorIndex,
                    method,
                    protocol: 'sync',
                    thrown: error
                });
                throw error;
            }
        }
    });
}

function trackAsyncMethod<Signature extends CallableSignature>(
    method: 'next' | 'return' | 'throw',
    target: TestDouble<Signature>,
    recorder: IteratorEventRecorder,
    iteratorIndex: number
): TestDouble<Signature> {
    return new Proxy(target, {
        apply(doubleTarget, thisArgument, argumentList): unknown {
            try {
                const result = Reflect.apply(doubleTarget, thisArgument, argumentList);

                void Promise
                    .resolve(result)
                    .catch(function recordThrow(error: unknown) {
                        recorder.recordThrow({
                            arguments: Array.from(argumentList),
                            iteratorIndex,
                            method,
                            protocol: 'async',
                            thrown: error
                        });
                    })
                    .then(function recordResult(settledResult) {
                        recorder.recordResult({
                            arguments: Array.from(argumentList),
                            iteratorIndex,
                            method,
                            protocol: 'async',
                            result: resultValue(settledResult)
                        });
                    });

                return result;
            } catch (error: unknown) {
                recorder.recordThrow({
                    arguments: Array.from(argumentList),
                    iteratorIndex,
                    method,
                    protocol: 'async',
                    thrown: error
                });
                throw error;
            }
        }
    });
}

function createSyncIterator<YieldValue, ReturnValue, NextValue>(
    methods: IteratorMethods<YieldValue, ReturnValue, NextValue>,
    recorder: IteratorEventRecorder,
    iteratorIndex: number
): TestIterator<YieldValue, ReturnValue, NextValue> {
    const trackedMethods = {
        next: trackSyncMethod('next', methods.next, recorder, iteratorIndex),
        return: trackSyncMethod('return', methods.return, recorder, iteratorIndex),
        throw: trackSyncMethod('throw', methods.throw, recorder, iteratorIndex)
    };
    const wrapped = Iterator.from(
        {
            next: trackedMethods.next,
            return: trackedMethods.return,
            throw: trackedMethods.throw
        }
    ) as unknown as TestIterator<
        YieldValue,
        ReturnValue,
        NextValue
    >;

    Object.defineProperties(wrapped, {
        next: {
            configurable: true,
            value: trackedMethods.next
        },
        return: {
            configurable: true,
            value: trackedMethods.return
        },
        throw: {
            configurable: true,
            value: trackedMethods.throw
        }
    });
    installProtocolMetadata(wrapped, {
        disposeMethod() {
            return Reflect.get(wrapped, Symbol.dispose) ?? null;
        },
        iteratorEvents: recorder.events,
        kind: 'iterator'
    });

    return wrapped;
}

function createAsyncIterator<YieldValue, ReturnValue, NextValue>(
    methods: AsyncIteratorMethods<YieldValue, ReturnValue, NextValue>,
    recorder: IteratorEventRecorder,
    iteratorIndex: number
): TestAsyncIterator<YieldValue, ReturnValue, NextValue> {
    const tracked = {
        next: trackAsyncMethod('next', methods.next, recorder, iteratorIndex),
        return: trackAsyncMethod('return', methods.return, recorder, iteratorIndex),
        throw: trackAsyncMethod('throw', methods.throw, recorder, iteratorIndex)
    };
    const iterator = {
        next: tracked.next,
        return: tracked.return,
        throw: tracked.throw,
        [Symbol.asyncIterator]() {
            return iterator;
        }
    } as TestAsyncIterator<YieldValue, ReturnValue, NextValue>;

    installProtocolMetadata(iterator, {
        disposeMethod() {
            return Reflect.get(iterator, Symbol.asyncDispose) ?? null;
        },
        iteratorEvents: recorder.events,
        kind: 'async-iterator'
    });

    return iterator;
}

function createDefaultSyncMethods<YieldValue, ReturnValue, NextValue>(): IteratorMethods<
    YieldValue,
    ReturnValue,
    NextValue
> {
    return {
        next: testDouble<SyncNext<YieldValue, ReturnValue, NextValue>>({
            answer() {
                return nextDone<YieldValue, ReturnValue>();
            }
        }),
        return: testDouble<SyncReturn<YieldValue, ReturnValue>>({
            answer(invocation) {
                return syncReturnDefault<YieldValue, ReturnValue>(
                    ...(invocation.arguments as unknown as readonly [] | readonly [ReturnValue])
                );
            }
        }),
        throw: testDouble<SyncThrow<YieldValue, ReturnValue>>({
            answer(invocation) {
                return syncThrowDefault<YieldValue, ReturnValue>(
                    ...(invocation.arguments as unknown as readonly [] | readonly [unknown])
                );
            }
        })
    };
}

function createDefaultAsyncMethods<YieldValue, ReturnValue, NextValue>(): AsyncIteratorMethods<
    YieldValue,
    ReturnValue,
    NextValue
> {
    return {
        next: testDouble<AsyncNext<YieldValue, ReturnValue, NextValue>>({
            async answer() {
                return asyncNextDone<YieldValue, ReturnValue>();
            }
        }),
        return: testDouble<AsyncReturn<YieldValue, ReturnValue>>({
            async answer(invocation) {
                return asyncReturnDefault<YieldValue, ReturnValue>(
                    ...(invocation.arguments as unknown as readonly [] | readonly [ReturnValue])
                );
            }
        }),
        throw: testDouble<AsyncThrow<YieldValue, ReturnValue>>({
            async answer(invocation) {
                return asyncThrowDefault<YieldValue, ReturnValue>(
                    ...(invocation.arguments as unknown as readonly [] | readonly [unknown])
                );
            }
        })
    };
}

function createConfiguredSyncMethods<YieldValue, ReturnValue, NextValue>(
    configuration: SyncIteratorConfiguration<YieldValue, ReturnValue, NextValue>
): IteratorMethods<YieldValue, ReturnValue, NextValue> {
    return {
        next: configuredMethod(configuration.next),
        return: configuredMethod(configuration.return),
        throw: configuredMethod(configuration.throw)
    };
}

function createConfiguredAsyncMethods<YieldValue, ReturnValue, NextValue>(
    configuration: AsyncIteratorConfiguration<YieldValue, ReturnValue, NextValue>
): AsyncIteratorMethods<YieldValue, ReturnValue, NextValue> {
    return {
        next: configuredMethod(configuration.next),
        return: configuredMethod(configuration.return),
        throw: configuredMethod(configuration.throw)
    };
}

function createYieldingSyncMethods<YieldValue, ReturnValue, NextValue>(
    values: readonly YieldValue[],
    returnValue: ReturnValue
): IteratorMethods<YieldValue, ReturnValue, NextValue> {
    const snapshot = Array.from(values);
    let index = 0;

    return {
        next: testDouble<SyncNext<YieldValue, ReturnValue, NextValue>>({
            answer() {
                if (index >= snapshot.length) {
                    return returnedResult(returnValue);
                }

                const value = snapshot[index] as YieldValue;
                index += 1;

                return {
                    done: false,
                    value
                };
            }
        }),
        return: testDouble<SyncReturn<YieldValue, ReturnValue>>({
            answer(invocation) {
                return syncReturnDefault<YieldValue, ReturnValue>(
                    ...(invocation.arguments as unknown as readonly [] | readonly [ReturnValue])
                );
            }
        }),
        throw: testDouble<SyncThrow<YieldValue, ReturnValue>>({
            answer(invocation) {
                return syncThrowDefault<YieldValue, ReturnValue>(
                    ...(invocation.arguments as unknown as readonly [] | readonly [unknown])
                );
            }
        })
    };
}

function createYieldingAsyncMethods<YieldValue, ReturnValue, NextValue>(
    values: readonly YieldValue[],
    returnValue: ReturnValue
): AsyncIteratorMethods<YieldValue, ReturnValue, NextValue> {
    const snapshot = Array.from(values);
    let index = 0;

    return {
        next: testDouble<AsyncNext<YieldValue, ReturnValue, NextValue>>({
            async answer() {
                if (index >= snapshot.length) {
                    return returnedResult(returnValue);
                }

                const value = snapshot[index] as YieldValue;
                index += 1;

                return {
                    done: false,
                    value
                };
            }
        }),
        return: testDouble<AsyncReturn<YieldValue, ReturnValue>>({
            async answer(invocation) {
                return asyncReturnDefault<YieldValue, ReturnValue>(
                    ...(invocation.arguments as unknown as readonly [] | readonly [ReturnValue])
                );
            }
        }),
        throw: testDouble<AsyncThrow<YieldValue, ReturnValue>>({
            async answer(invocation) {
                return asyncThrowDefault<YieldValue, ReturnValue>(
                    ...(invocation.arguments as unknown as readonly [] | readonly [unknown])
                );
            }
        })
    };
}

function isSyncIterable<YieldValue>(value: unknown): value is Iterable<YieldValue> {
    return typeof value === 'object' && value !== null && typeof Reflect.get(value, Symbol.iterator) === 'function';
}

function isAsyncIterable<YieldValue>(value: unknown): value is AsyncIterable<YieldValue> {
    return typeof value === 'object' && value !== null &&
        typeof Reflect.get(value, Symbol.asyncIterator) === 'function';
}

function syncIteratorFrom<YieldValue, ReturnValue, NextValue>(
    value: SyncIteratorSource<YieldValue, ReturnValue, NextValue>
): Iterator<YieldValue, ReturnValue, NextValue> {
    return isSyncIterable<YieldValue>(value)
        ? value[Symbol.iterator]() as Iterator<YieldValue, ReturnValue, NextValue>
        : value;
}

function asyncIteratorFrom<YieldValue, ReturnValue, NextValue>(
    value: AsyncIteratorSource<YieldValue, ReturnValue, NextValue>
): AsyncIterator<YieldValue, ReturnValue, NextValue> | Iterator<YieldValue, ReturnValue, NextValue> {
    if (isAsyncIterable<YieldValue>(value)) {
        return value[Symbol.asyncIterator]() as AsyncIterator<YieldValue, ReturnValue, NextValue>;
    }

    return isSyncIterable<YieldValue>(value)
        ? value[Symbol.iterator]() as Iterator<YieldValue, ReturnValue, NextValue>
        : value;
}

function cachedSource<Value>(source: () => Value): () => Value {
    let cached: Value | null = null;

    return function currentSource() {
        if (cached === null) {
            cached = source();
        }

        return cached;
    };
}

function createDelegatingSyncMethods<YieldValue, ReturnValue, NextValue>(
    sourceFactory: () => SyncIteratorSource<YieldValue, ReturnValue, NextValue>
): IteratorMethods<YieldValue, ReturnValue, NextValue> {
    const current = cachedSource(function createSource() {
        return syncIteratorFrom(sourceFactory());
    });

    return {
        next: testDouble<SyncNext<YieldValue, ReturnValue, NextValue>>({
            answer(invocation) {
                const parameters = invocation.arguments as unknown as readonly [] | readonly [NextValue];

                return current().next(...parameters);
            }
        }),
        return: testDouble<SyncReturn<YieldValue, ReturnValue>>({
            answer(invocation) {
                const iterator = current();
                const parameters = invocation.arguments as unknown as readonly [] | readonly [ReturnValue];
                const returnMethod = iterator.return;

                return typeof returnMethod === 'function'
                    ? returnMethod.call(iterator, ...parameters)
                    : syncReturnDefault(...parameters);
            }
        }),
        throw: testDouble<SyncThrow<YieldValue, ReturnValue>>({
            answer(invocation) {
                const iterator = current();
                const parameters = invocation.arguments as unknown as readonly [] | readonly [unknown];
                const throwMethod = iterator.throw;

                return typeof throwMethod === 'function'
                    ? throwMethod.call(iterator, ...parameters)
                    : syncThrowDefault(...parameters);
            }
        })
    };
}

function createDelegatingAsyncMethods<YieldValue, ReturnValue, NextValue>(
    sourceFactory: () => AsyncIteratorSource<YieldValue, ReturnValue, NextValue>
): AsyncIteratorMethods<YieldValue, ReturnValue, NextValue> {
    const current = cachedSource(function createSource() {
        return asyncIteratorFrom(sourceFactory());
    });

    return {
        next: testDouble<AsyncNext<YieldValue, ReturnValue, NextValue>>({
            async answer(invocation) {
                const parameters = invocation.arguments as unknown as readonly [] | readonly [NextValue];

                return await current().next(...parameters);
            }
        }),
        return: testDouble<AsyncReturn<YieldValue, ReturnValue>>({
            async answer(invocation) {
                const iterator = current();
                const parameters = invocation.arguments as unknown as readonly [] | readonly [ReturnValue];
                const returnMethod = iterator.return;

                if (typeof returnMethod !== 'function') {
                    return await asyncReturnDefault(...parameters);
                }

                const returnValue = returnMethod as (
                    ...arguments_: readonly unknown[]
                ) => IteratorResult<YieldValue, ReturnValue> | Promise<IteratorResult<YieldValue, ReturnValue>>;

                return await returnValue(...parameters);
            }
        }),
        throw: testDouble<AsyncThrow<YieldValue, ReturnValue>>({
            async answer(invocation) {
                const iterator = current();
                const parameters = invocation.arguments as unknown as readonly [] | readonly [unknown];
                const throwMethod = iterator.throw;

                if (typeof throwMethod !== 'function') {
                    return await asyncThrowDefault(...parameters);
                }

                const throwValue = throwMethod as (
                    ...arguments_: readonly unknown[]
                ) => IteratorResult<YieldValue, ReturnValue> | Promise<IteratorResult<YieldValue, ReturnValue>>;

                return await throwValue(...parameters);
            }
        })
    };
}

function createSyncIteratorFromMethods<YieldValue, ReturnValue, NextValue>(
    methods: IteratorMethods<YieldValue, ReturnValue, NextValue>
): TestIterator<YieldValue, ReturnValue, NextValue> {
    return createSyncIterator(methods, createIteratorEventRecorder(), 0);
}

function createAsyncIteratorFromMethods<YieldValue, ReturnValue, NextValue>(
    methods: AsyncIteratorMethods<YieldValue, ReturnValue, NextValue>
): TestAsyncIterator<YieldValue, ReturnValue, NextValue> {
    return createAsyncIterator(methods, createIteratorEventRecorder(), 0);
}

function createSyncIterableFromFactory<YieldValue, ReturnValue, NextValue>(
    createIterator: () => TestIterator<YieldValue, ReturnValue, NextValue>
): TestIterable<YieldValue, ReturnValue, NextValue> {
    const iterator = testDouble<() => TestIterator<YieldValue, ReturnValue, NextValue>>({
        answer() {
            return createIterator();
        }
    });
    const iterable = {
        [Symbol.iterator]: iterator
    } as TestIterable<YieldValue, ReturnValue, NextValue>;

    installProtocolMetadata(iterable, {
        disposeMethod() {
            return null;
        },
        iteratorEvents() {
            return iterator.calls.flatMap(function iteratorCall(call) {
                return call.result.status === 'returned'
                    ? protocolIteratorEvents(call.result.value) ?? []
                    : [];
            });
        },
        kind: 'iterable'
    });

    return iterable;
}

function createAsyncIterableFromFactory<YieldValue, ReturnValue, NextValue>(
    createIterator: () => TestAsyncIterator<YieldValue, ReturnValue, NextValue>
): TestAsyncIterable<YieldValue, ReturnValue, NextValue> {
    const asyncIterator = testDouble<() => TestAsyncIterator<YieldValue, ReturnValue, NextValue>>({
        answer() {
            return createIterator();
        }
    });
    const iterable = {
        [Symbol.asyncIterator]: asyncIterator
    } as TestAsyncIterable<YieldValue, ReturnValue, NextValue>;

    installProtocolMetadata(iterable, {
        disposeMethod() {
            return null;
        },
        iteratorEvents() {
            return asyncIterator.calls.flatMap(function iteratorCall(call) {
                return call.result.status === 'returned'
                    ? protocolIteratorEvents(call.result.value) ?? []
                    : [];
            });
        },
        kind: 'async-iterable'
    });

    return iterable;
}

export type TestIteratorFactory = {
    <YieldValue = unknown, ReturnValue = undefined, NextValue = unknown>(
        configuration: SyncIteratorConfiguration<YieldValue, ReturnValue, NextValue>
    ): TestIterator<YieldValue, ReturnValue, NextValue>;
    (): TestIterator;
    readonly yields: {
        <YieldValue>(values: readonly YieldValue[]): TestIterator<YieldValue, undefined>;
        <YieldValue, ReturnValue>(
            values: readonly YieldValue[],
            returnValue: ReturnValue
        ): TestIterator<YieldValue, ReturnValue>;
    };
    readonly yieldsFrom: <YieldValue, ReturnValue = unknown, NextValue = unknown>(
        sourceFactory: () => SyncIteratorSource<YieldValue, ReturnValue, NextValue>
    ) => TestIterator<YieldValue, ReturnValue, NextValue>;
};

export type TestAsyncIteratorFactory = {
    <YieldValue = unknown, ReturnValue = undefined, NextValue = unknown>(
        configuration: AsyncIteratorConfiguration<YieldValue, ReturnValue, NextValue>
    ): TestAsyncIterator<YieldValue, ReturnValue, NextValue>;
    (): TestAsyncIterator;
    readonly yields: {
        <YieldValue>(values: readonly YieldValue[]): TestAsyncIterator<YieldValue, undefined>;
        <YieldValue, ReturnValue>(
            values: readonly YieldValue[],
            returnValue: ReturnValue
        ): TestAsyncIterator<YieldValue, ReturnValue>;
    };
    readonly yieldsFrom: <YieldValue, ReturnValue = unknown, NextValue = unknown>(
        sourceFactory: () => AsyncIteratorSource<YieldValue, ReturnValue, NextValue>
    ) => TestAsyncIterator<YieldValue, ReturnValue, NextValue>;
};

export type TestIterableFactory = {
    <YieldValue = unknown, ReturnValue = undefined, NextValue = unknown>(
        configuration: SyncIterableConfiguration<YieldValue, ReturnValue, NextValue>
    ): TestIterable<YieldValue, ReturnValue, NextValue>;
    (): TestIterable;
    readonly yields: {
        <YieldValue>(values: readonly YieldValue[]): TestIterable<YieldValue, undefined>;
        <YieldValue, ReturnValue>(
            values: readonly YieldValue[],
            returnValue: ReturnValue
        ): TestIterable<YieldValue, ReturnValue>;
    };
    readonly yieldsFrom: <YieldValue, ReturnValue = unknown, NextValue = unknown>(
        sourceFactory: () => SyncIteratorSource<YieldValue, ReturnValue, NextValue>
    ) => TestIterable<YieldValue, ReturnValue, NextValue>;
};

export type TestAsyncIterableFactory = {
    <YieldValue = unknown, ReturnValue = undefined, NextValue = unknown>(
        configuration: AsyncIterableConfiguration<YieldValue, ReturnValue, NextValue>
    ): TestAsyncIterable<YieldValue, ReturnValue, NextValue>;
    (): TestAsyncIterable;
    readonly yields: {
        <YieldValue>(values: readonly YieldValue[]): TestAsyncIterable<YieldValue, undefined>;
        <YieldValue, ReturnValue>(
            values: readonly YieldValue[],
            returnValue: ReturnValue
        ): TestAsyncIterable<YieldValue, ReturnValue>;
    };
    readonly yieldsFrom: <YieldValue, ReturnValue = unknown, NextValue = unknown>(
        sourceFactory: () => AsyncIteratorSource<YieldValue, ReturnValue, NextValue>
    ) => TestAsyncIterable<YieldValue, ReturnValue, NextValue>;
};

export type TestDisposableFactory = {
    (configuration: DisposableConfiguration): TestDisposable;
    (): TestDisposable;
};

export type TestAsyncDisposableFactory = {
    (configuration: AsyncDisposableConfiguration): TestAsyncDisposable;
    (): TestAsyncDisposable;
};

function createTestIterator(
    ...configuration: readonly [] | readonly [SyncIteratorConfiguration<unknown, unknown, unknown>]
): TestIterator {
    return createSyncIteratorFromMethods(
        configuration[0] === undefined ? createDefaultSyncMethods() : createConfiguredSyncMethods(configuration[0])
    );
}

function createTestAsyncIterator(
    ...configuration: readonly [] | readonly [AsyncIteratorConfiguration<unknown, unknown, unknown>]
): TestAsyncIterator {
    return createAsyncIteratorFromMethods(
        configuration[0] === undefined ? createDefaultAsyncMethods() : createConfiguredAsyncMethods(configuration[0])
    );
}

function createTestIterable(
    ...configuration: readonly [] | readonly [SyncIterableConfiguration<unknown, unknown, unknown>]
): TestIterable {
    if (configuration[0] !== undefined) {
        const iterator = configuredMethod(configuration[0].iterator);
        const iterable = {
            [Symbol.iterator]: iterator
        } as TestIterable;

        installProtocolMetadata(iterable, {
            disposeMethod() {
                return null;
            },
            iteratorEvents() {
                return iterator.calls.flatMap(function iteratorCall(call) {
                    return call.result.status === 'returned'
                        ? protocolIteratorEvents(call.result.value) ?? []
                        : [];
                });
            },
            kind: 'iterable'
        });

        return iterable;
    }

    return createSyncIterableFromFactory(function createIterator() {
        return createSyncIteratorFromMethods(createDefaultSyncMethods());
    });
}

function createTestAsyncIterable(
    ...configuration: readonly [] | readonly [AsyncIterableConfiguration<unknown, unknown, unknown>]
): TestAsyncIterable {
    if (configuration[0] !== undefined) {
        const asyncIterator = configuredMethod(configuration[0].asyncIterator);
        const iterable = {
            [Symbol.asyncIterator]: asyncIterator
        } as TestAsyncIterable;

        installProtocolMetadata(iterable, {
            disposeMethod() {
                return null;
            },
            iteratorEvents() {
                return asyncIterator.calls.flatMap(function iteratorCall(call) {
                    return call.result.status === 'returned'
                        ? protocolIteratorEvents(call.result.value) ?? []
                        : [];
                });
            },
            kind: 'async-iterable'
        });

        return iterable;
    }

    return createAsyncIterableFromFactory(function createIterator() {
        return createAsyncIteratorFromMethods(createDefaultAsyncMethods());
    });
}

function createTestDisposable(
    ...configuration: readonly [] | readonly [DisposableConfiguration]
): TestDisposable {
    const dispose = configuration[0] === undefined
        ? testDouble.returns<() => void>()
        : configuredMethod(configuration[0].dispose);
    const disposable = {
        [Symbol.dispose]: dispose
    } as TestDisposable;

    installProtocolMetadata(disposable, {
        disposeMethod() {
            return dispose;
        },
        iteratorEvents() {
            return [];
        },
        kind: 'disposable'
    });

    return disposable;
}

function createTestAsyncDisposable(
    ...configuration: readonly [] | readonly [AsyncDisposableConfiguration]
): TestAsyncDisposable {
    const asyncDispose = configuration[0] === undefined
        ? testDouble.resolves<() => Promise<void>>(undefined)
        : configuredMethod(configuration[0].asyncDispose);
    const disposable = {
        [Symbol.asyncDispose]: asyncDispose
    } as TestAsyncDisposable;

    installProtocolMetadata(disposable, {
        disposeMethod() {
            return asyncDispose;
        },
        iteratorEvents() {
            return [];
        },
        kind: 'async-disposable'
    });

    return disposable;
}

export const testIterator: TestIteratorFactory = Object.assign(createTestIterator, {
    yields<YieldValue, ReturnValue>(
        values: readonly YieldValue[],
        ...returnValue: readonly [] | readonly [ReturnValue]
    ) {
        return createSyncIteratorFromMethods(createYieldingSyncMethods(values, returnValue[0]));
    },
    yieldsFrom<YieldValue, ReturnValue = unknown, NextValue = unknown>(
        sourceFactory: () => SyncIteratorSource<YieldValue, ReturnValue, NextValue>
    ) {
        return createSyncIteratorFromMethods(createDelegatingSyncMethods(sourceFactory));
    }
});

export const testAsyncIterator: TestAsyncIteratorFactory = Object.assign(createTestAsyncIterator, {
    yields<YieldValue, ReturnValue>(
        values: readonly YieldValue[],
        ...returnValue: readonly [] | readonly [ReturnValue]
    ) {
        return createAsyncIteratorFromMethods(createYieldingAsyncMethods(values, returnValue[0]));
    },
    yieldsFrom<YieldValue, ReturnValue = unknown, NextValue = unknown>(
        sourceFactory: () => AsyncIteratorSource<YieldValue, ReturnValue, NextValue>
    ) {
        return createAsyncIteratorFromMethods(createDelegatingAsyncMethods(sourceFactory));
    }
});

export const testIterable: TestIterableFactory = Object.assign(createTestIterable, {
    yields<YieldValue, ReturnValue>(
        values: readonly YieldValue[],
        ...returnValue: readonly [] | readonly [ReturnValue]
    ) {
        return createSyncIterableFromFactory(function createIterator() {
            return createSyncIteratorFromMethods(createYieldingSyncMethods(values, returnValue[0]));
        });
    },
    yieldsFrom<YieldValue, ReturnValue = unknown, NextValue = unknown>(
        sourceFactory: () => SyncIteratorSource<YieldValue, ReturnValue, NextValue>
    ) {
        return createSyncIterableFromFactory(function createIterator() {
            return createSyncIteratorFromMethods(createDelegatingSyncMethods(sourceFactory));
        });
    }
});

export const testAsyncIterable: TestAsyncIterableFactory = Object.assign(createTestAsyncIterable, {
    yields<YieldValue, ReturnValue>(
        values: readonly YieldValue[],
        ...returnValue: readonly [] | readonly [ReturnValue]
    ) {
        return createAsyncIterableFromFactory(function createIterator() {
            return createAsyncIteratorFromMethods(createYieldingAsyncMethods(values, returnValue[0]));
        });
    },
    yieldsFrom<YieldValue, ReturnValue = unknown, NextValue = unknown>(
        sourceFactory: () => AsyncIteratorSource<YieldValue, ReturnValue, NextValue>
    ) {
        return createAsyncIterableFromFactory(function createIterator() {
            return createAsyncIteratorFromMethods(createDelegatingAsyncMethods(sourceFactory));
        });
    }
});

export const testDisposable: TestDisposableFactory = createTestDisposable;
export const testAsyncDisposable: TestAsyncDisposableFactory = createTestAsyncDisposable;

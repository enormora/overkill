/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-use-before-define, functional/prefer-tacit, max-lines, restricted-syntax-typescript/no-inline-signature-type-literal, sonarjs/no-identical-functions -- TypeScript cannot model the Iterator.from and sync-or-async source bridge precisely. */
import type { DoubleIteratorEvent } from './double-history-record.ts';
import type { UnknownFunction } from './double-behavior.ts';
import { disposeSymbol } from './disposal-symbol.ts';
import {
    installProtocolMetadata,
    protocolIteratorEvents
} from './protocol-double-metadata.ts';
import {
    testDouble,
    type TestDouble,
    type TestDoubleConfiguration
} from './test-double.ts';

type SyncNext<YieldValue, ReturnValue> = UnknownFunction<IteratorResult<YieldValue, ReturnValue>>;
type SyncReturn<YieldValue, ReturnValue> = UnknownFunction<IteratorResult<YieldValue, ReturnValue>>;
type SyncThrow<YieldValue, ReturnValue> = UnknownFunction<IteratorResult<YieldValue, ReturnValue>>;

type AsyncNext<YieldValue, ReturnValue> = UnknownFunction<Promise<IteratorResult<YieldValue, ReturnValue>>>;
type AsyncReturn<YieldValue, ReturnValue> = UnknownFunction<Promise<IteratorResult<YieldValue, ReturnValue>>>;
type AsyncThrow<YieldValue, ReturnValue> = UnknownFunction<Promise<IteratorResult<YieldValue, ReturnValue>>>;

export type TestIterator<
    YieldValue = unknown,
    ReturnValue = unknown,
    NextValue = unknown
> = IteratorObject<YieldValue, ReturnValue, NextValue> & {
    readonly next: TestDouble<SyncNext<YieldValue, ReturnValue>>;
    readonly return: TestDouble<SyncReturn<YieldValue, ReturnValue>>;
    readonly throw: TestDouble<SyncThrow<YieldValue, ReturnValue>>;
};

export type TestAsyncIterator<
    YieldValue = unknown,
    ReturnValue = unknown,
    NextValue = unknown
> = AsyncIterable<YieldValue> & AsyncIterator<YieldValue, ReturnValue, NextValue> & {
    readonly next: TestDouble<AsyncNext<YieldValue, ReturnValue>>;
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

export type SyncIteratorConfiguration<YieldValue, ReturnValue> = {
    readonly next: TestDoubleConfiguration<SyncNext<YieldValue, ReturnValue>>;
    readonly return: TestDoubleConfiguration<SyncReturn<YieldValue, ReturnValue>>;
    readonly throw: TestDoubleConfiguration<SyncThrow<YieldValue, ReturnValue>>;
};

export type AsyncIteratorConfiguration<YieldValue, ReturnValue> = {
    readonly next: TestDoubleConfiguration<AsyncNext<YieldValue, ReturnValue>>;
    readonly return: TestDoubleConfiguration<AsyncReturn<YieldValue, ReturnValue>>;
    readonly throw: TestDoubleConfiguration<AsyncThrow<YieldValue, ReturnValue>>;
};

export type SyncIterableConfiguration<YieldValue, ReturnValue, NextValue> = {
    readonly iterator: TestDoubleConfiguration<() => TestIterator<YieldValue, ReturnValue, NextValue>>;
};

export type AsyncIterableConfiguration<YieldValue, ReturnValue, NextValue> = {
    readonly asyncIterator: TestDoubleConfiguration<() => TestAsyncIterator<YieldValue, ReturnValue, NextValue>>;
};

export type AsyncIteratorMethods<YieldValue, ReturnValue> = {
    readonly next: TestDouble<AsyncNext<YieldValue, ReturnValue>>;
    readonly return: TestDouble<AsyncReturn<YieldValue, ReturnValue>>;
    readonly throw: TestDouble<AsyncThrow<YieldValue, ReturnValue>>;
};

type SyncIteratorSourceVariants<YieldValue, ReturnValue> = {
    readonly iterable: Iterable<YieldValue>;
    readonly iterator: Iterator<YieldValue, ReturnValue, unknown>;
};

type AsyncIteratorSourceVariants<YieldValue, ReturnValue> = {
    readonly asyncIterable: AsyncIterable<YieldValue>;
    readonly asyncIterator: AsyncIterator<YieldValue, ReturnValue, unknown>;
    readonly iterable: Iterable<YieldValue>;
    readonly iterator: Iterator<YieldValue, ReturnValue, unknown>;
};

export type SyncIteratorSource<YieldValue, ReturnValue> = SyncIteratorSourceVariants<
    YieldValue,
    ReturnValue
>[keyof SyncIteratorSourceVariants<YieldValue, ReturnValue>];

export type AsyncIteratorSource<YieldValue, ReturnValue> = AsyncIteratorSourceVariants<
    YieldValue,
    ReturnValue
>[keyof AsyncIteratorSourceVariants<YieldValue, ReturnValue>];

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

function returnedResult<Value>(value: Value): IteratorReturnResult<Value> {
    return {
        done: true,
        value
    };
}

function doneResult<YieldValue, ReturnValue>(): IteratorResult<YieldValue, ReturnValue> {
    return returnedResult(undefined as ReturnValue);
}

function syncReturnDefault<YieldValue, ReturnValue>(value: unknown): IteratorResult<YieldValue, ReturnValue> {
    return returnedResult(value as ReturnValue);
}

function syncThrowDefault<YieldValue, ReturnValue>(thrown: unknown): IteratorResult<YieldValue, ReturnValue> {
    throw thrown;
}

async function asyncReturnDefault<YieldValue, ReturnValue>(
    value: unknown
): Promise<IteratorResult<YieldValue, ReturnValue>> {
    return returnedResult(value as ReturnValue);
}

async function asyncThrowDefault<YieldValue, ReturnValue>(
    thrown: unknown
): Promise<IteratorResult<YieldValue, ReturnValue>> {
    throw thrown;
}

function resultValue(value: unknown): IteratorResult<unknown, unknown> {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, 'done')) {
        return returnedResult(value);
    }

    return Reflect.get(value, 'done') === true
        ? returnedResult(Reflect.get(value, 'value'))
        : {
            done: false,
            value: Reflect.get(value, 'value')
        };
}

function trackedSyncNext<YieldValue, ReturnValue>(
    core: TestDouble<SyncNext<YieldValue, ReturnValue>>,
    recorder: IteratorEventRecorder,
    iteratorIndex: number
): TestDouble<SyncNext<YieldValue, ReturnValue>> {
    return testDouble<SyncNext<YieldValue, ReturnValue>>({
        answer(invocation) {
            try {
                const result = core(...invocation.arguments);
                recorder.recordResult({
                    arguments: invocation.arguments,
                    iteratorIndex,
                    method: 'next',
                    protocol: 'sync',
                    result: resultValue(result)
                });
                return result;
            } catch (error: unknown) {
                recorder.recordThrow({
                    arguments: invocation.arguments,
                    iteratorIndex,
                    method: 'next',
                    protocol: 'sync',
                    thrown: error
                });
                throw error;
            }
        }
    });
}

function trackedSyncReturn<YieldValue, ReturnValue>(
    core: TestDouble<SyncReturn<YieldValue, ReturnValue>>,
    recorder: IteratorEventRecorder,
    iteratorIndex: number
): TestDouble<SyncReturn<YieldValue, ReturnValue>> {
    return testDouble<SyncReturn<YieldValue, ReturnValue>>({
        answer(invocation) {
            try {
                const result = core(...invocation.arguments);
                recorder.recordResult({
                    arguments: invocation.arguments,
                    iteratorIndex,
                    method: 'return',
                    protocol: 'sync',
                    result: resultValue(result)
                });
                return result;
            } catch (error: unknown) {
                recorder.recordThrow({
                    arguments: invocation.arguments,
                    iteratorIndex,
                    method: 'return',
                    protocol: 'sync',
                    thrown: error
                });
                throw error;
            }
        }
    });
}

function trackedSyncThrow<YieldValue, ReturnValue>(
    core: TestDouble<SyncThrow<YieldValue, ReturnValue>>,
    recorder: IteratorEventRecorder,
    iteratorIndex: number
): TestDouble<SyncThrow<YieldValue, ReturnValue>> {
    return testDouble<SyncThrow<YieldValue, ReturnValue>>({
        answer(invocation) {
            try {
                const result = core(...invocation.arguments);
                recorder.recordResult({
                    arguments: invocation.arguments,
                    iteratorIndex,
                    method: 'throw',
                    protocol: 'sync',
                    result: resultValue(result)
                });
                return result;
            } catch (error: unknown) {
                recorder.recordThrow({
                    arguments: invocation.arguments,
                    iteratorIndex,
                    method: 'throw',
                    protocol: 'sync',
                    thrown: error
                });
                throw error;
            }
        }
    });
}

function trackedAsyncNext<YieldValue, ReturnValue>(
    core: TestDouble<AsyncNext<YieldValue, ReturnValue>>,
    recorder: IteratorEventRecorder,
    iteratorIndex: number
): TestDouble<AsyncNext<YieldValue, ReturnValue>> {
    return testDouble<AsyncNext<YieldValue, ReturnValue>>({
        async answer(invocation) {
            try {
                const result = await core(...invocation.arguments);
                recorder.recordResult({
                    arguments: invocation.arguments,
                    iteratorIndex,
                    method: 'next',
                    protocol: 'async',
                    result: resultValue(result)
                });
                return result;
            } catch (error: unknown) {
                recorder.recordThrow({
                    arguments: invocation.arguments,
                    iteratorIndex,
                    method: 'next',
                    protocol: 'async',
                    thrown: error
                });
                throw error;
            }
        }
    });
}

function trackedAsyncReturn<YieldValue, ReturnValue>(
    core: TestDouble<AsyncReturn<YieldValue, ReturnValue>>,
    recorder: IteratorEventRecorder,
    iteratorIndex: number
): TestDouble<AsyncReturn<YieldValue, ReturnValue>> {
    return testDouble<AsyncReturn<YieldValue, ReturnValue>>({
        async answer(invocation) {
            try {
                const result = await core(...invocation.arguments);
                recorder.recordResult({
                    arguments: invocation.arguments,
                    iteratorIndex,
                    method: 'return',
                    protocol: 'async',
                    result: resultValue(result)
                });
                return result;
            } catch (error: unknown) {
                recorder.recordThrow({
                    arguments: invocation.arguments,
                    iteratorIndex,
                    method: 'return',
                    protocol: 'async',
                    thrown: error
                });
                throw error;
            }
        }
    });
}

function trackedAsyncThrow<YieldValue, ReturnValue>(
    core: TestDouble<AsyncThrow<YieldValue, ReturnValue>>,
    recorder: IteratorEventRecorder,
    iteratorIndex: number
): TestDouble<AsyncThrow<YieldValue, ReturnValue>> {
    return testDouble<AsyncThrow<YieldValue, ReturnValue>>({
        async answer(invocation) {
            try {
                const result = await core(...invocation.arguments);
                recorder.recordResult({
                    arguments: invocation.arguments,
                    iteratorIndex,
                    method: 'throw',
                    protocol: 'async',
                    result: resultValue(result)
                });
                return result;
            } catch (error: unknown) {
                recorder.recordThrow({
                    arguments: invocation.arguments,
                    iteratorIndex,
                    method: 'throw',
                    protocol: 'async',
                    thrown: error
                });
                throw error;
            }
        }
    });
}

function trackedSyncMethods<YieldValue, ReturnValue>(
    methods: {
        readonly next: TestDouble<SyncNext<YieldValue, ReturnValue>>;
        readonly return: TestDouble<SyncReturn<YieldValue, ReturnValue>>;
        readonly throw: TestDouble<SyncThrow<YieldValue, ReturnValue>>;
    },
    recorder: IteratorEventRecorder,
    iteratorIndex: number
) {
    return {
        next: trackedSyncNext(methods.next, recorder, iteratorIndex),
        return: trackedSyncReturn(methods.return, recorder, iteratorIndex),
        throw: trackedSyncThrow(methods.throw, recorder, iteratorIndex)
    };
}

function trackedAsyncMethods<YieldValue, ReturnValue>(
    methods: {
        readonly next: TestDouble<AsyncNext<YieldValue, ReturnValue>>;
        readonly return: TestDouble<AsyncReturn<YieldValue, ReturnValue>>;
        readonly throw: TestDouble<AsyncThrow<YieldValue, ReturnValue>>;
    },
    recorder: IteratorEventRecorder,
    iteratorIndex: number
) {
    return {
        next: trackedAsyncNext(methods.next, recorder, iteratorIndex),
        return: trackedAsyncReturn(methods.return, recorder, iteratorIndex),
        throw: trackedAsyncThrow(methods.throw, recorder, iteratorIndex)
    };
}

function createSyncIterator<YieldValue, ReturnValue, NextValue>(
    methods: {
        readonly next: TestDouble<SyncNext<YieldValue, ReturnValue>>;
        readonly return: TestDouble<SyncReturn<YieldValue, ReturnValue>>;
        readonly throw: TestDouble<SyncThrow<YieldValue, ReturnValue>>;
    },
    recorder: IteratorEventRecorder,
    iteratorIndex: number
): TestIterator<YieldValue, ReturnValue, NextValue> {
    const tracked = trackedSyncMethods(methods, recorder, iteratorIndex);
    const bareIterator: Iterator<YieldValue, unknown, undefined> = {
        next() {
            return tracked.next();
        },
        return(value) {
            return tracked.return(value);
        },
        throw(value) {
            return tracked.throw(value);
        }
    };
    const iterator = Object.assign(Iterator.from(bareIterator), tracked) as unknown as TestIterator<
        YieldValue,
        ReturnValue,
        NextValue
    >;

    installProtocolMetadata(iterator, {
        disposeMethod() {
            const dispose = Reflect.get(iterator, disposeSymbol);

            return typeof dispose === 'function' ? dispose : null;
        },
        iteratorEvents: recorder.events,
        kind: 'iterator'
    });

    return iterator;
}

function createAsyncIterator<YieldValue, ReturnValue, NextValue>(
    methods: AsyncIteratorMethods<YieldValue, ReturnValue>,
    recorder: IteratorEventRecorder,
    iteratorIndex: number
): TestAsyncIterator<YieldValue, ReturnValue, NextValue> {
    const tracked = trackedAsyncMethods(methods, recorder, iteratorIndex);
    const iterator: TestAsyncIterator<YieldValue, ReturnValue, NextValue> = {
        next: tracked.next,
        return: tracked.return,
        throw: tracked.throw,
        [Symbol.asyncIterator]() {
            return iterator;
        }
    };

    installProtocolMetadata(iterator, {
        disposeMethod() {
            return null;
        },
        iteratorEvents: recorder.events,
        kind: 'async-iterator'
    });

    return iterator;
}

export function createDefaultSyncMethods<YieldValue, ReturnValue>(): {
    readonly next: TestDouble<SyncNext<YieldValue, ReturnValue>>;
    readonly return: TestDouble<SyncReturn<YieldValue, ReturnValue>>;
    readonly throw: TestDouble<SyncThrow<YieldValue, ReturnValue>>;
} {
    return {
        next: testDouble<SyncNext<YieldValue, ReturnValue>>({
            answer: doneResult
        }),
        return: testDouble<SyncReturn<YieldValue, ReturnValue>>({
            answer(invocation) {
                return syncReturnDefault<YieldValue, ReturnValue>(invocation.arguments[0]);
            }
        }),
        throw: testDouble<SyncThrow<YieldValue, ReturnValue>>({
            answer(invocation) {
                return syncThrowDefault<YieldValue, ReturnValue>(invocation.arguments[0]);
            }
        })
    };
}

export function createDefaultAsyncMethods<YieldValue, ReturnValue>(): AsyncIteratorMethods<
    YieldValue,
    ReturnValue
> {
    return {
        next: testDouble<AsyncNext<YieldValue, ReturnValue>>({
            async answer() {
                return doneResult();
            }
        }),
        return: testDouble<AsyncReturn<YieldValue, ReturnValue>>({
            async answer(invocation) {
                return asyncReturnDefault<YieldValue, ReturnValue>(invocation.arguments[0]);
            }
        }),
        throw: testDouble<AsyncThrow<YieldValue, ReturnValue>>({
            async answer(invocation) {
                return asyncThrowDefault<YieldValue, ReturnValue>(invocation.arguments[0]);
            }
        })
    };
}

export function createConfiguredSyncMethods<YieldValue, ReturnValue>(
    configuration: SyncIteratorConfiguration<YieldValue, ReturnValue>
) {
    return {
        next: testDouble(configuration.next),
        return: testDouble(configuration.return),
        throw: testDouble(configuration.throw)
    };
}

export function createConfiguredAsyncMethods<YieldValue, ReturnValue>(
    configuration: AsyncIteratorConfiguration<YieldValue, ReturnValue>
): AsyncIteratorMethods<YieldValue, ReturnValue> {
    return {
        next: testDouble(configuration.next),
        return: testDouble(configuration.return),
        throw: testDouble(configuration.throw)
    };
}

export function createYieldingSyncMethods<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue: ReturnValue
) {
    const iterator = values[Symbol.iterator]();

    return createDelegatingSyncMethods<YieldValue, ReturnValue>(function source() {
        return {
            next() {
                const next = iterator.next();

                return next.done === true ? returnedResult(returnValue) : next;
            }
        };
    });
}

export function createYieldingAsyncMethods<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue: ReturnValue
) {
    const iterator = values[Symbol.iterator]();

    return createDelegatingAsyncMethods<YieldValue, ReturnValue>(function source() {
        return {
            async next() {
                const next = iterator.next();

                return next.done === true ? returnedResult(returnValue) : next;
            }
        };
    });
}

function isSyncIterable<YieldValue>(value: unknown): value is Iterable<YieldValue> {
    return value !== null && typeof value === 'object' &&
        typeof Reflect.get(value, Symbol.iterator) === 'function';
}

function isAsyncIterable<YieldValue>(value: unknown): value is AsyncIterable<YieldValue> {
    return value !== null && typeof value === 'object' &&
        typeof Reflect.get(value, Symbol.asyncIterator) === 'function';
}

function syncIteratorFrom<YieldValue, ReturnValue>(
    value: SyncIteratorSource<YieldValue, ReturnValue>
): Iterator<YieldValue, ReturnValue, unknown> {
    if (isSyncIterable<YieldValue>(value)) {
        return value[Symbol.iterator]();
    }

    return value;
}

function asyncIteratorFrom<YieldValue, ReturnValue>(
    value: AsyncIteratorSource<YieldValue, ReturnValue>
): AsyncIterator<YieldValue, ReturnValue, unknown> | Iterator<YieldValue, ReturnValue, unknown> {
    if (isAsyncIterable<YieldValue>(value)) {
        return value[Symbol.asyncIterator]();
    }

    return isSyncIterable<YieldValue>(value) ? value[Symbol.iterator]() : value;
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

export function createDelegatingSyncMethods<YieldValue, ReturnValue>(
    sourceFactory: () => SyncIteratorSource<YieldValue, ReturnValue>
) {
    const current = cachedSource(function createSource() {
        return syncIteratorFrom(sourceFactory());
    });

    return {
        next: testDouble<SyncNext<YieldValue, ReturnValue>>({
            answer(invocation) {
                return current().next(invocation.arguments[0]);
            }
        }),
        return: testDouble<SyncReturn<YieldValue, ReturnValue>>({
            answer(invocation) {
                const iterator = current();
                const returnMethod = iterator.return;

                return typeof returnMethod === 'function'
                    ? returnMethod.call(iterator, invocation.arguments[0] as ReturnValue)
                    : syncReturnDefault(invocation.arguments[0]);
            }
        }),
        throw: testDouble<SyncThrow<YieldValue, ReturnValue>>({
            answer(invocation) {
                const iterator = current();
                const throwMethod = iterator.throw;

                return typeof throwMethod === 'function'
                    ? throwMethod.call(iterator, invocation.arguments[0])
                    : syncThrowDefault(invocation.arguments[0]);
            }
        })
    };
}

export function createDelegatingAsyncMethods<YieldValue, ReturnValue>(
    sourceFactory: () => AsyncIteratorSource<YieldValue, ReturnValue>
): AsyncIteratorMethods<YieldValue, ReturnValue> {
    const current = cachedSource(function createSource() {
        return asyncIteratorFrom(sourceFactory());
    });

    return {
        next: testDouble<AsyncNext<YieldValue, ReturnValue>>({
            async answer(invocation) {
                return current().next(invocation.arguments[0]);
            }
        }),
        return: testDouble<AsyncReturn<YieldValue, ReturnValue>>({
            async answer(invocation) {
                const iterator = current();
                const returnMethod = iterator.return;

                if (typeof returnMethod !== 'function') {
                    return asyncReturnDefault(invocation.arguments[0]);
                }

                return await Reflect.apply(returnMethod, iterator, [
                    invocation.arguments[0]
                ]) as IteratorResult<YieldValue, ReturnValue> | Promise<IteratorResult<YieldValue, ReturnValue>>;
            }
        }),
        throw: testDouble<AsyncThrow<YieldValue, ReturnValue>>({
            async answer(invocation) {
                const iterator = current();
                const throwMethod = iterator.throw;

                if (typeof throwMethod !== 'function') {
                    return asyncThrowDefault(invocation.arguments[0]);
                }

                return await Reflect.apply(throwMethod, iterator, [
                    invocation.arguments[0]
                ]) as IteratorResult<YieldValue, ReturnValue> | Promise<IteratorResult<YieldValue, ReturnValue>>;
            }
        })
    };
}

function iteratorEventsFor(call: {
    readonly result: {
        readonly status: string;
        readonly value?: unknown;
    };
}): readonly DoubleIteratorEvent[] {
    return call.result.status === 'returned'
        ? protocolIteratorEvents(call.result.value) ?? []
        : [];
}

export function createSyncIteratorFromMethods<YieldValue, ReturnValue, NextValue>(
    methods: {
        readonly next: TestDouble<SyncNext<YieldValue, ReturnValue>>;
        readonly return: TestDouble<SyncReturn<YieldValue, ReturnValue>>;
        readonly throw: TestDouble<SyncThrow<YieldValue, ReturnValue>>;
    }
): TestIterator<YieldValue, ReturnValue, NextValue> {
    return createSyncIterator(methods, createIteratorEventRecorder(), 0);
}

export function createAsyncIteratorFromMethods<YieldValue, ReturnValue, NextValue>(
    methods: AsyncIteratorMethods<YieldValue, ReturnValue>
): TestAsyncIterator<YieldValue, ReturnValue, NextValue> {
    return createAsyncIterator(methods, createIteratorEventRecorder(), 0);
}

export function createSyncIterableFromFactory<YieldValue, ReturnValue, NextValue>(
    createIterator: () => TestIterator<YieldValue, ReturnValue, NextValue>
): TestIterable<YieldValue, ReturnValue, NextValue> {
    const iterator = testDouble<() => TestIterator<YieldValue, ReturnValue, NextValue>>({
        answer: createIterator
    });

    return createSyncIterableFromMethod(iterator);
}

export function createSyncIterableFromMethod<YieldValue, ReturnValue, NextValue>(
    iterator: TestDouble<() => TestIterator<YieldValue, ReturnValue, NextValue>>
): TestIterable<YieldValue, ReturnValue, NextValue> {
    const iterable: TestIterable<YieldValue, ReturnValue, NextValue> = {
        [Symbol.iterator]: iterator
    };

    installProtocolMetadata(iterable, {
        disposeMethod() {
            return null;
        },
        iteratorEvents() {
            return iterator.calls.flatMap(iteratorEventsFor);
        },
        kind: 'iterable'
    });

    return iterable;
}

export function createAsyncIterableFromFactory<YieldValue, ReturnValue, NextValue>(
    createIterator: () => TestAsyncIterator<YieldValue, ReturnValue, NextValue>
): TestAsyncIterable<YieldValue, ReturnValue, NextValue> {
    const asyncIterator = testDouble<() => TestAsyncIterator<YieldValue, ReturnValue, NextValue>>({
        answer: createIterator
    });

    return createAsyncIterableFromMethod(asyncIterator);
}

export function createAsyncIterableFromMethod<YieldValue, ReturnValue, NextValue>(
    asyncIterator: TestDouble<() => TestAsyncIterator<YieldValue, ReturnValue, NextValue>>
): TestAsyncIterable<YieldValue, ReturnValue, NextValue> {
    const iterable: TestAsyncIterable<YieldValue, ReturnValue, NextValue> = {
        [Symbol.asyncIterator]: asyncIterator
    };

    installProtocolMetadata(iterable, {
        disposeMethod() {
            return null;
        },
        iteratorEvents() {
            return asyncIterator.calls.flatMap(iteratorEventsFor);
        },
        kind: 'async-iterable'
    });

    return iterable;
}

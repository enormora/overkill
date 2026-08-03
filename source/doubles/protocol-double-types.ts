import type { CallableSignature, UnknownFunction } from './double-behavior.ts';
import type {
    TestDouble,
    TestDoubleConfiguration
} from './test-double.ts';

export type SyncNext<YieldValue, ReturnValue> = UnknownFunction<IteratorResult<YieldValue, ReturnValue>>;
export type SyncReturn<YieldValue, ReturnValue> = UnknownFunction<IteratorResult<YieldValue, ReturnValue>>;
export type SyncThrow<YieldValue, ReturnValue> = UnknownFunction<IteratorResult<YieldValue, ReturnValue>>;

export type AsyncNext<YieldValue, ReturnValue> = UnknownFunction<Promise<IteratorResult<YieldValue, ReturnValue>>>;
export type AsyncReturn<YieldValue, ReturnValue> = UnknownFunction<Promise<IteratorResult<YieldValue, ReturnValue>>>;
export type AsyncThrow<YieldValue, ReturnValue> = UnknownFunction<Promise<IteratorResult<YieldValue, ReturnValue>>>;

export type ProtocolMethodConfiguration<Signature extends CallableSignature> = TestDoubleConfiguration<Signature>;

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

export type TestDisposable = Disposable & {
    readonly dispose: TestDouble<() => void>;
};

export type TestAsyncDisposable = AsyncDisposable & {
    readonly asyncDispose: TestDouble<() => Promise<void>>;
};

export type SyncIteratorConfiguration<YieldValue, ReturnValue> = {
    readonly next: ProtocolMethodConfiguration<SyncNext<YieldValue, ReturnValue>>;
    readonly return: ProtocolMethodConfiguration<SyncReturn<YieldValue, ReturnValue>>;
    readonly throw: ProtocolMethodConfiguration<SyncThrow<YieldValue, ReturnValue>>;
};

export type AsyncIteratorConfiguration<YieldValue, ReturnValue> = {
    readonly next: ProtocolMethodConfiguration<AsyncNext<YieldValue, ReturnValue>>;
    readonly return: ProtocolMethodConfiguration<AsyncReturn<YieldValue, ReturnValue>>;
    readonly throw: ProtocolMethodConfiguration<AsyncThrow<YieldValue, ReturnValue>>;
};

export type SyncIterableConfiguration<YieldValue, ReturnValue, NextValue> = {
    readonly iterator: ProtocolMethodConfiguration<() => TestIterator<YieldValue, ReturnValue, NextValue>>;
};

export type AsyncIterableConfiguration<YieldValue, ReturnValue, NextValue> = {
    readonly asyncIterator: ProtocolMethodConfiguration<() => TestAsyncIterator<YieldValue, ReturnValue, NextValue>>;
};

export type DisposableConfiguration = {
    readonly dispose: ProtocolMethodConfiguration<() => void>;
};

export type AsyncDisposableConfiguration = {
    readonly asyncDispose: ProtocolMethodConfiguration<() => Promise<void>>;
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

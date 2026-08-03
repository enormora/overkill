import {
    type BehaviorMode,
    type CallableSignature,
    type RuntimeFixedBehavior,
    type RuntimeBehavior,
    type RuntimeRule,
    yieldsAsyncBehavior,
    yieldsAsyncFromBehavior,
    yieldsBehavior,
    yieldsFromBehavior
} from './double-behavior.ts';

type VoidReturn = ReturnType<() => void>;
type CallArguments<Signature> = Signature extends (...arguments_: infer Arguments) => unknown ? Arguments
    : never;
type GeneratorBehaviorKind = 'yields' | 'yields-async' | 'yields-async-from' | 'yields-from';
type CallBehavior<Result = unknown> = RuntimeFixedBehavior<'call', Result, GeneratorBehaviorKind>;
type CallRule<
    ArgumentPattern extends readonly unknown[],
    Result,
    MatchKind extends 'arguments' | 'index',
    Behavior extends RuntimeBehavior<BehaviorMode, Result> = RuntimeBehavior<BehaviorMode, Result>
> = RuntimeRule<'call', ArgumentPattern, Result, MatchKind, Behavior>;

type CallCriterion<ArgumentPattern extends readonly unknown[], MatchKind extends 'arguments' | 'index'> = CallRule<
    ArgumentPattern,
    unknown,
    MatchKind
>['criterion'];

type SyncGeneratorValue = Generator<unknown, unknown, unknown> | IterableIterator<unknown>;
type AsyncGeneratorValue = AsyncGenerator<unknown, unknown, unknown> | AsyncIterableIterator<unknown>;
type SyncYieldingIterator<YieldValue> = Generator<YieldValue, unknown, unknown> | IterableIterator<YieldValue>;
type AsyncYieldingIteratorKind = keyof {
    readonly asyncGenerator: unknown;
    readonly asyncIterator: unknown;
};
type AsyncYieldingIterator<YieldValue> = {
    readonly asyncGenerator: AsyncGenerator<YieldValue, unknown, unknown>;
    readonly asyncIterator: AsyncIterableIterator<YieldValue>;
}[AsyncYieldingIteratorKind];
type SyncReturningGenerator<ReturnValue> = Generator<unknown, ReturnValue, unknown>;
type AsyncReturningGenerator<ReturnValue> = AsyncGenerator<unknown, ReturnValue, unknown>;
type AsyncGeneratorSourceKind = keyof {
    readonly async: unknown;
    readonly sync: unknown;
};
type AsyncGeneratorSource<YieldValue> = {
    readonly async: AsyncIterable<YieldValue>;
    readonly sync: Iterable<YieldValue>;
}[AsyncGeneratorSourceKind];

type SyncGeneratorSupport<Signature extends CallableSignature> = ReturnType<Signature> extends SyncGeneratorValue
    ? 'supported'
    : 'unsupported';

type AsyncGeneratorSupport<Signature extends CallableSignature> = ReturnType<Signature> extends AsyncGeneratorValue
    ? 'supported'
    : 'unsupported';

type GeneratorSignatureBySupport<Signature> = {
    readonly supported: Signature;
    readonly unsupported: never;
};

export type SyncGeneratorSignature<Signature extends CallableSignature> = GeneratorSignatureBySupport<
    Signature
>[SyncGeneratorSupport<Signature>];

export type AsyncGeneratorSignature<Signature extends CallableSignature> = GeneratorSignatureBySupport<
    Signature
>[AsyncGeneratorSupport<Signature>];

export type SyncYieldValue<Value> = Value extends SyncYieldingIterator<infer YieldValue> ? YieldValue
    : never;

export type AsyncYieldValue<Value> = Value extends AsyncYieldingIterator<infer YieldValue> ? YieldValue
    : never;

type SyncGeneratorReturnValue<Value> = Value extends SyncReturningGenerator<infer ReturnValue> ? ReturnValue
    : never;

type SyncIteratorReturnValue<Value> = Value extends IterableIterator<unknown> ? unknown
    : never;

type AsyncGeneratorReturnValue<Value> = Value extends AsyncReturningGenerator<infer ReturnValue> ? ReturnValue
    : never;

type AsyncIteratorReturnValue<Value> = Value extends AsyncIterableIterator<unknown> ? unknown
    : never;

type SyncReturnSupport<Value> = [SyncGeneratorReturnValue<Value>] extends [never] ? 'iterator' : 'generator';

type AsyncReturnSupport<Value> = [AsyncGeneratorReturnValue<Value>] extends [never] ? 'iterator' : 'generator';

type SyncReturnBySupport<Value> = {
    readonly generator: SyncGeneratorReturnValue<Value>;
    readonly iterator: SyncIteratorReturnValue<Value>;
};

type AsyncReturnBySupport<Value> = {
    readonly generator: AsyncGeneratorReturnValue<Value>;
    readonly iterator: AsyncIteratorReturnValue<Value>;
};

type SyncReturnValue<Value> = SyncReturnBySupport<Value>[SyncReturnSupport<Value>];

type AsyncReturnValue<Value> = AsyncReturnBySupport<Value>[AsyncReturnSupport<Value>];

export type SyncReturnArguments<Value> = SyncReturnValue<Value> extends VoidReturn
    ? readonly [] | readonly [SyncReturnValue<Value>]
    : readonly [SyncReturnValue<Value>];

export type AsyncReturnArguments<Value> = AsyncReturnValue<Value> extends VoidReturn
    ? readonly [] | readonly [AsyncReturnValue<Value>]
    : readonly [AsyncReturnValue<Value>];

export type SyncSourceFactory<Signature extends CallableSignature> = (
    ...arguments_: CallArguments<Signature>
) => ReturnType<SyncGeneratorSignature<Signature>>;

export type AsyncSourceFactory<Signature extends CallableSignature> = (
    ...arguments_: CallArguments<Signature>
) => AsyncGeneratorSource<AsyncYieldValue<ReturnType<AsyncGeneratorSignature<Signature>>>>;

export type YieldingBehaviorFactory = {
    <YieldValue>(values: readonly YieldValue[]): CallBehavior<Generator<YieldValue, undefined, unknown>>;
    <YieldValue, ReturnValue>(
        values: readonly YieldValue[],
        returnValue: ReturnValue
    ): CallBehavior<Generator<YieldValue, ReturnValue, unknown>>;
    <Signature extends CallableSignature>(
        values: readonly SyncYieldValue<ReturnType<SyncGeneratorSignature<Signature>>>[],
        ...returnValue: SyncReturnArguments<ReturnType<SyncGeneratorSignature<Signature>>>
    ): CallBehavior<ReturnType<SyncGeneratorSignature<Signature>>>;
};

export type YieldingFromBehaviorFactory = {
    <SourceFactory extends (...arguments_: readonly unknown[]) => Iterable<unknown>>(
        sourceFactory: SourceFactory
    ): CallBehavior<ReturnType<SourceFactory>>;
    <Signature extends CallableSignature>(
        sourceFactory: SyncSourceFactory<Signature>
    ): CallBehavior<ReturnType<SyncGeneratorSignature<Signature>>>;
};

export type AsyncYieldingBehaviorFactory = {
    <YieldValue>(values: readonly YieldValue[]): CallBehavior<AsyncGenerator<YieldValue, undefined, unknown>>;
    <YieldValue, ReturnValue>(
        values: readonly YieldValue[],
        returnValue: ReturnValue
    ): CallBehavior<AsyncGenerator<YieldValue, ReturnValue, unknown>>;
    <Signature extends CallableSignature>(
        values: readonly AsyncYieldValue<ReturnType<AsyncGeneratorSignature<Signature>>>[],
        ...returnValue: AsyncReturnArguments<ReturnType<AsyncGeneratorSignature<Signature>>>
    ): CallBehavior<ReturnType<AsyncGeneratorSignature<Signature>>>;
};

export type AsyncYieldingFromBehaviorFactory = {
    <SourceFactory extends (...arguments_: readonly unknown[]) => AsyncIterable<unknown> | Iterable<unknown>>(
        sourceFactory: SourceFactory
    ): CallBehavior<ReturnType<SourceFactory>>;
    <Signature extends CallableSignature>(
        sourceFactory: AsyncSourceFactory<Signature>
    ): CallBehavior<ReturnType<AsyncGeneratorSignature<Signature>>>;
};

export type YieldingRuleTerminator<
    ArgumentPattern extends readonly unknown[],
    MatchKind extends 'arguments' | 'index'
> = {
    <YieldValue>(values: readonly YieldValue[]): CallRule<
        ArgumentPattern,
        Generator<YieldValue, undefined, unknown>,
        MatchKind,
        CallBehavior<Generator<YieldValue, undefined, unknown>>
    >;
    <YieldValue, ReturnValue>(
        values: readonly YieldValue[],
        returnValue: ReturnValue
    ): CallRule<
        ArgumentPattern,
        Generator<YieldValue, ReturnValue, unknown>,
        MatchKind,
        CallBehavior<Generator<YieldValue, ReturnValue, unknown>>
    >;
    <Signature extends CallableSignature>(
        values: readonly SyncYieldValue<ReturnType<SyncGeneratorSignature<Signature>>>[],
        ...returnValue: SyncReturnArguments<ReturnType<SyncGeneratorSignature<Signature>>>
    ): CallRule<
        ArgumentPattern,
        ReturnType<SyncGeneratorSignature<Signature>>,
        MatchKind,
        CallBehavior<ReturnType<SyncGeneratorSignature<Signature>>>
    >;
};

export type YieldingFromRuleTerminator<
    ArgumentPattern extends readonly unknown[],
    MatchKind extends 'arguments' | 'index'
> = {
    <SourceFactory extends (...arguments_: readonly unknown[]) => Iterable<unknown>>(
        sourceFactory: SourceFactory
    ): CallRule<ArgumentPattern, ReturnType<SourceFactory>, MatchKind, CallBehavior<ReturnType<SourceFactory>>>;
    <Signature extends CallableSignature>(
        sourceFactory: SyncSourceFactory<Signature>
    ): CallRule<
        ArgumentPattern,
        ReturnType<SyncGeneratorSignature<Signature>>,
        MatchKind,
        CallBehavior<ReturnType<SyncGeneratorSignature<Signature>>>
    >;
};

export type AsyncYieldingRuleTerminator<
    ArgumentPattern extends readonly unknown[],
    MatchKind extends 'arguments' | 'index'
> = {
    <YieldValue>(values: readonly YieldValue[]): CallRule<
        ArgumentPattern,
        AsyncGenerator<YieldValue, undefined, unknown>,
        MatchKind,
        CallBehavior<AsyncGenerator<YieldValue, undefined, unknown>>
    >;
    <YieldValue, ReturnValue>(
        values: readonly YieldValue[],
        returnValue: ReturnValue
    ): CallRule<
        ArgumentPattern,
        AsyncGenerator<YieldValue, ReturnValue, unknown>,
        MatchKind,
        CallBehavior<AsyncGenerator<YieldValue, ReturnValue, unknown>>
    >;
    <Signature extends CallableSignature>(
        values: readonly AsyncYieldValue<ReturnType<AsyncGeneratorSignature<Signature>>>[],
        ...returnValue: AsyncReturnArguments<ReturnType<AsyncGeneratorSignature<Signature>>>
    ): CallRule<
        ArgumentPattern,
        ReturnType<AsyncGeneratorSignature<Signature>>,
        MatchKind,
        CallBehavior<ReturnType<AsyncGeneratorSignature<Signature>>>
    >;
};

export type AsyncYieldingFromRuleTerminator<
    ArgumentPattern extends readonly unknown[],
    MatchKind extends 'arguments' | 'index'
> = {
    <SourceFactory extends (...arguments_: readonly unknown[]) => AsyncIterable<unknown> | Iterable<unknown>>(
        sourceFactory: SourceFactory
    ): CallRule<ArgumentPattern, ReturnType<SourceFactory>, MatchKind, CallBehavior<ReturnType<SourceFactory>>>;
    <Signature extends CallableSignature>(
        sourceFactory: AsyncSourceFactory<Signature>
    ): CallRule<
        ArgumentPattern,
        ReturnType<AsyncGeneratorSignature<Signature>>,
        MatchKind,
        CallBehavior<ReturnType<AsyncGeneratorSignature<Signature>>>
    >;
};

function callRule<
    ArgumentPattern extends readonly unknown[],
    Result,
    MatchKind extends 'arguments' | 'index',
    Behavior extends RuntimeBehavior<BehaviorMode, Result> = RuntimeBehavior<BehaviorMode, Result>
>(
    criterion: CallCriterion<ArgumentPattern, MatchKind>,
    behavior: Behavior
): CallRule<ArgumentPattern, Result, MatchKind, Behavior> {
    return { behavior, criterion };
}

export function createYieldingRuleTerminator<
    ArgumentPattern extends readonly unknown[],
    MatchKind extends 'arguments' | 'index'
>(
    criterion: CallCriterion<ArgumentPattern, MatchKind>
): YieldingRuleTerminator<ArgumentPattern, MatchKind> {
    function yields<YieldValue>(values: readonly YieldValue[]): CallRule<
        ArgumentPattern,
        Generator<YieldValue, undefined, unknown>,
        MatchKind,
        CallBehavior<Generator<YieldValue, undefined, unknown>>
    >;
    function yields<YieldValue, ReturnValue>(
        values: readonly YieldValue[],
        returnValue: ReturnValue
    ): CallRule<
        ArgumentPattern,
        Generator<YieldValue, ReturnValue, unknown>,
        MatchKind,
        CallBehavior<Generator<YieldValue, ReturnValue, unknown>>
    >;
    function yields<Signature extends CallableSignature>(
        values: readonly SyncYieldValue<ReturnType<SyncGeneratorSignature<Signature>>>[],
        ...returnValue: SyncReturnArguments<ReturnType<SyncGeneratorSignature<Signature>>>
    ): CallRule<
        ArgumentPattern,
        ReturnType<SyncGeneratorSignature<Signature>>,
        MatchKind,
        CallBehavior<ReturnType<SyncGeneratorSignature<Signature>>>
    >;
    function yields(
        values: readonly unknown[],
        ...returnValue: readonly [] | readonly [unknown]
    ): CallRule<
        ArgumentPattern,
        Generator<unknown, unknown, unknown>,
        MatchKind,
        CallBehavior<Generator<unknown, unknown, unknown>>
    > {
        return callRule(criterion, yieldsBehavior(values, returnValue[0]));
    }

    return yields;
}

export function createYieldingFromRuleTerminator<
    ArgumentPattern extends readonly unknown[],
    MatchKind extends 'arguments' | 'index'
>(
    criterion: CallCriterion<ArgumentPattern, MatchKind>
): YieldingFromRuleTerminator<ArgumentPattern, MatchKind> {
    function yieldsFrom<SourceFactory extends (...arguments_: readonly unknown[]) => Iterable<unknown>>(
        sourceFactory: SourceFactory
    ): CallRule<ArgumentPattern, ReturnType<SourceFactory>, MatchKind, CallBehavior<ReturnType<SourceFactory>>>;
    function yieldsFrom<Signature extends CallableSignature>(
        sourceFactory: SyncSourceFactory<Signature>
    ): CallRule<
        ArgumentPattern,
        ReturnType<SyncGeneratorSignature<Signature>>,
        MatchKind,
        CallBehavior<ReturnType<SyncGeneratorSignature<Signature>>>
    >;
    function yieldsFrom(
        sourceFactory: (...arguments_: readonly unknown[]) => Iterable<unknown>
    ): CallRule<ArgumentPattern, Iterable<unknown>, MatchKind, CallBehavior<Iterable<unknown>>> {
        return callRule(criterion, yieldsFromBehavior(sourceFactory));
    }

    return yieldsFrom;
}

export function createAsyncYieldingRuleTerminator<
    ArgumentPattern extends readonly unknown[],
    MatchKind extends 'arguments' | 'index'
>(
    criterion: CallCriterion<ArgumentPattern, MatchKind>
): AsyncYieldingRuleTerminator<ArgumentPattern, MatchKind> {
    function yieldsAsync<YieldValue>(values: readonly YieldValue[]): CallRule<
        ArgumentPattern,
        AsyncGenerator<YieldValue, undefined, unknown>,
        MatchKind,
        CallBehavior<AsyncGenerator<YieldValue, undefined, unknown>>
    >;
    function yieldsAsync<YieldValue, ReturnValue>(
        values: readonly YieldValue[],
        returnValue: ReturnValue
    ): CallRule<
        ArgumentPattern,
        AsyncGenerator<YieldValue, ReturnValue, unknown>,
        MatchKind,
        CallBehavior<AsyncGenerator<YieldValue, ReturnValue, unknown>>
    >;
    function yieldsAsync<Signature extends CallableSignature>(
        values: readonly AsyncYieldValue<ReturnType<AsyncGeneratorSignature<Signature>>>[],
        ...returnValue: AsyncReturnArguments<ReturnType<AsyncGeneratorSignature<Signature>>>
    ): CallRule<
        ArgumentPattern,
        ReturnType<AsyncGeneratorSignature<Signature>>,
        MatchKind,
        CallBehavior<ReturnType<AsyncGeneratorSignature<Signature>>>
    >;
    function yieldsAsync(
        values: readonly unknown[],
        ...returnValue: readonly [] | readonly [unknown]
    ): CallRule<
        ArgumentPattern,
        AsyncGenerator<unknown, unknown, unknown>,
        MatchKind,
        CallBehavior<AsyncGenerator<unknown, unknown, unknown>>
    > {
        return callRule(criterion, yieldsAsyncBehavior(values, returnValue[0]));
    }

    return yieldsAsync;
}

export function createAsyncYieldingFromRuleTerminator<
    ArgumentPattern extends readonly unknown[],
    MatchKind extends 'arguments' | 'index'
>(
    criterion: CallCriterion<ArgumentPattern, MatchKind>
): AsyncYieldingFromRuleTerminator<ArgumentPattern, MatchKind> {
    function yieldsAsyncFrom<
        SourceFactory extends (...arguments_: readonly unknown[]) => AsyncIterable<unknown> | Iterable<unknown>
    >(sourceFactory: SourceFactory): CallRule<
        ArgumentPattern,
        ReturnType<SourceFactory>,
        MatchKind,
        CallBehavior<ReturnType<SourceFactory>>
    >;
    function yieldsAsyncFrom<Signature extends CallableSignature>(
        sourceFactory: AsyncSourceFactory<Signature>
    ): CallRule<
        ArgumentPattern,
        ReturnType<AsyncGeneratorSignature<Signature>>,
        MatchKind,
        CallBehavior<ReturnType<AsyncGeneratorSignature<Signature>>>
    >;
    function yieldsAsyncFrom(
        sourceFactory: (...arguments_: readonly unknown[]) => AsyncIterable<unknown> | Iterable<unknown>
    ): CallRule<
        ArgumentPattern,
        AsyncIterable<unknown> | Iterable<unknown>,
        MatchKind,
        CallBehavior<AsyncIterable<unknown> | Iterable<unknown>>
    > {
        return callRule(criterion, yieldsAsyncFromBehavior(sourceFactory));
    }

    return yieldsAsyncFrom;
}

export function createYieldingBehavior<YieldValue>(
    values: readonly YieldValue[]
): CallBehavior<Generator<YieldValue, undefined, unknown>>;
export function createYieldingBehavior<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue: ReturnValue
): CallBehavior<Generator<YieldValue, ReturnValue, unknown>>;
export function createYieldingBehavior<Signature extends CallableSignature>(
    values: readonly SyncYieldValue<ReturnType<SyncGeneratorSignature<Signature>>>[],
    ...returnValue: SyncReturnArguments<ReturnType<SyncGeneratorSignature<Signature>>>
): CallBehavior<ReturnType<SyncGeneratorSignature<Signature>>>;
export function createYieldingBehavior(
    values: readonly unknown[],
    ...returnValue: readonly [] | readonly [unknown]
): CallBehavior {
    return yieldsBehavior(values, returnValue[0]);
}

export const createYieldingFromBehavior: YieldingFromBehaviorFactory = yieldsFromBehavior;

export function createAsyncYieldingBehavior<YieldValue>(
    values: readonly YieldValue[]
): CallBehavior<AsyncGenerator<YieldValue, undefined, unknown>>;
export function createAsyncYieldingBehavior<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue: ReturnValue
): CallBehavior<AsyncGenerator<YieldValue, ReturnValue, unknown>>;
export function createAsyncYieldingBehavior<Signature extends CallableSignature>(
    values: readonly AsyncYieldValue<ReturnType<AsyncGeneratorSignature<Signature>>>[],
    ...returnValue: AsyncReturnArguments<ReturnType<AsyncGeneratorSignature<Signature>>>
): CallBehavior<ReturnType<AsyncGeneratorSignature<Signature>>>;
export function createAsyncYieldingBehavior(
    values: readonly unknown[],
    ...returnValue: readonly [] | readonly [unknown]
): CallBehavior {
    return yieldsAsyncBehavior(values, returnValue[0]);
}

export const createAsyncYieldingFromBehavior: AsyncYieldingFromBehaviorFactory = yieldsAsyncFromBehavior;

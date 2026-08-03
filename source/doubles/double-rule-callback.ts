import {
    type BehaviorMode,
    type CallbackBehaviorKind,
    type Invocation,
    isUnknownFunction,
    type RuntimeBehavior,
    type RuntimeFixedBehavior,
    type RuntimeRule,
    type UnknownFunction
} from './double-behavior.ts';
import type { CallArguments, CallReturn } from './double-signature.ts';

export type CallbackRuntimeBehavior<
    Index extends number = number,
    CallbackArguments extends readonly unknown[] = readonly unknown[],
    Result = unknown,
    Receiver = unknown,
    Kind extends CallbackBehaviorKind = CallbackBehaviorKind
> = RuntimeFixedBehavior<'call', Result, Kind> & {
    readonly callbackArguments: CallbackArguments;
    readonly callbackIndex: Index;
    readonly callbackReceiver: Receiver;
};

type CallInvocation = Invocation & {
    readonly kind: 'call';
};
type CallRule<
    ArgumentPattern extends readonly unknown[],
    Result,
    MatchKind extends 'arguments' | 'index',
    Behavior extends RuntimeBehavior<BehaviorMode, Result> = RuntimeBehavior<BehaviorMode, Result>
> = RuntimeRule<'call', ArgumentPattern, Result, MatchKind, Behavior>;
type CallbackParameter = (...arguments_: readonly never[]) => unknown;
type TupleKey<Values extends readonly unknown[]> = Exclude<keyof Values, keyof unknown[]>;
type NumericKey<Key> = Key extends `${infer Index extends number}` ? Index : never;
type KeyForIndex<Values extends readonly unknown[], Index extends number> = {
    readonly [Key in TupleKey<Values>]: NumericKey<Key> extends Index ? Key : never;
}[TupleKey<Values>];
type CallbackIndex<Arguments extends readonly unknown[]> = {
    readonly [Key in TupleKey<Arguments>]: Extract<
        NonNullable<Arguments[Key]>,
        CallbackParameter
    > extends never ? never
        : NumericKey<Key>;
}[TupleKey<Arguments>];
type CallbackAt<Arguments extends readonly unknown[], Index extends number> = Extract<
    NonNullable<Arguments[KeyForIndex<Arguments, Index>]>,
    CallbackParameter
>;
type CallbackReceiver<Callback> = unknown extends ThisParameterType<Callback> ? unknown
    : ThisParameterType<Callback>;
type CallbackBehaviorForIndex<
    Arguments extends readonly unknown[],
    Result,
    Index extends CallbackIndex<Arguments>
> = CallbackRuntimeBehavior<
    Index,
    readonly [...Parameters<CallbackAt<Arguments, Index>>],
    Result,
    CallbackReceiver<CallbackAt<Arguments, Index>>
>;
type TypedCallbackBehaviorFor<Arguments extends readonly unknown[], Result> = {
    readonly [Index in CallbackIndex<Arguments>]: CallbackBehaviorForIndex<Arguments, Result, Index>;
}[CallbackIndex<Arguments>];

export type CallbackBehaviorFor<Signature> = number extends CallArguments<Signature>['length']
    ? CallbackRuntimeBehavior<number, readonly unknown[], CallReturn<Signature>>
    : TypedCallbackBehaviorFor<CallArguments<Signature>, CallReturn<Signature>>;

export type CallbackBehaviorFactory = {
    <const Index extends number, const CallbackArguments extends readonly unknown[], Result>(
        index: Index,
        callbackArguments: CallbackArguments,
        returnValue: Result
    ): CallbackRuntimeBehavior<Index, CallbackArguments, Result, undefined>;
    <const Index extends number, const CallbackArguments extends readonly unknown[], Result, Receiver>(
        index: Index,
        callbackArguments: CallbackArguments,
        returnValue: Result,
        receiver: Receiver
    ): CallbackRuntimeBehavior<Index, CallbackArguments, Result, Receiver>;
};

export type CallbackRuleTerminator<
    ArgumentPattern extends readonly unknown[],
    MatchKind extends 'arguments' | 'index',
    Kind extends CallbackBehaviorKind = 'calls-callback'
> = {
    <const Index extends number, const CallbackArguments extends readonly unknown[], Result>(
        index: Index,
        callbackArguments: CallbackArguments,
        returnValue: Result
    ): CallRule<
        ArgumentPattern,
        Result,
        MatchKind,
        CallbackRuntimeBehavior<Index, CallbackArguments, Result, undefined, Kind>
    >;
    <const Index extends number, const CallbackArguments extends readonly unknown[], Result, Receiver>(
        index: Index,
        callbackArguments: CallbackArguments,
        returnValue: Result,
        receiver: Receiver
    ): CallRule<
        ArgumentPattern,
        Result,
        MatchKind,
        CallbackRuntimeBehavior<Index, CallbackArguments, Result, Receiver, Kind>
    >;
};

function ensureCallInvocation(invocation: Invocation): asserts invocation is CallInvocation {
    if (invocation.kind !== 'call') {
        throw new TypeError('callback behavior can only answer calls.');
    }
}

function validCallbackIndex(index: number): number {
    if (!Number.isSafeInteger(index) || index < 0) {
        throw new TypeError('callback behavior requires a non-negative integer argument index.');
    }

    return index;
}

function callbackArgumentFrom(invocation: Invocation, index: number, source: string): UnknownFunction<unknown> {
    ensureCallInvocation(invocation);

    const callback = invocation.arguments[index];

    if (!isUnknownFunction(callback)) {
        throw new TypeError(`${source} requires argument ${index} to be a function.`);
    }

    return callback;
}

export function callsCallbackBehavior<
    Index extends number,
    CallbackArguments extends readonly unknown[],
    Result
>(
    index: Index,
    callbackArguments: CallbackArguments,
    returnValue: Result
): CallbackRuntimeBehavior<Index, CallbackArguments, Result, undefined, 'calls-callback'>;
export function callsCallbackBehavior<
    Index extends number,
    CallbackArguments extends readonly unknown[],
    Result,
    Receiver
>(
    index: Index,
    callbackArguments: CallbackArguments,
    returnValue: Result,
    receiver: Receiver
): CallbackRuntimeBehavior<Index, CallbackArguments, Result, Receiver, 'calls-callback'>;
export function callsCallbackBehavior(
    index: number,
    callbackArguments: readonly unknown[],
    returnValue: unknown,
    ...receiver: readonly [] | readonly [unknown]
): CallbackRuntimeBehavior<number, readonly unknown[], unknown, unknown, 'calls-callback'> {
    const callbackIndex = validCallbackIndex(index);
    const callbackArgumentSnapshot = Array.from(callbackArguments);
    const callbackReceiver = receiver[0];

    return {
        behaviorKind: 'calls-callback',
        callbackArguments,
        callbackIndex: index,
        callbackReceiver,
        mode: 'call',
        result() {
            return returnValue;
        },
        produce(invocation) {
            const callback = callbackArgumentFrom(invocation, callbackIndex, 'callsCallback()');

            Reflect.apply(callback, callbackReceiver, callbackArgumentSnapshot);

            return returnValue;
        }
    };
}

export function callsCallbackAsyncBehavior<
    Index extends number,
    CallbackArguments extends readonly unknown[],
    Result
>(
    index: Index,
    callbackArguments: CallbackArguments,
    returnValue: Result
): CallbackRuntimeBehavior<Index, CallbackArguments, Result, undefined, 'calls-callback-async'>;
export function callsCallbackAsyncBehavior<
    Index extends number,
    CallbackArguments extends readonly unknown[],
    Result,
    Receiver
>(
    index: Index,
    callbackArguments: CallbackArguments,
    returnValue: Result,
    receiver: Receiver
): CallbackRuntimeBehavior<Index, CallbackArguments, Result, Receiver, 'calls-callback-async'>;
export function callsCallbackAsyncBehavior(
    index: number,
    callbackArguments: readonly unknown[],
    returnValue: unknown,
    ...receiver: readonly [] | readonly [unknown]
): CallbackRuntimeBehavior<number, readonly unknown[], unknown, unknown, 'calls-callback-async'> {
    const callbackIndex = validCallbackIndex(index);
    const callbackArgumentSnapshot = Array.from(callbackArguments);
    const callbackReceiver = receiver[0];

    return {
        behaviorKind: 'calls-callback-async',
        callbackArguments,
        callbackIndex: index,
        callbackReceiver,
        mode: 'call',
        result() {
            return returnValue;
        },
        produce(invocation) {
            const callback = callbackArgumentFrom(invocation, callbackIndex, 'callsCallbackAsync()');

            queueMicrotask(function callCallback() {
                Reflect.apply(callback, callbackReceiver, callbackArgumentSnapshot);
            });

            return returnValue;
        }
    };
}

function callRule<
    ArgumentPattern extends readonly unknown[],
    Result,
    MatchKind extends 'arguments' | 'index',
    Behavior extends RuntimeBehavior<BehaviorMode, Result>
>(
    criterion: CallRule<ArgumentPattern, Result, MatchKind>['criterion'],
    behavior: Behavior
): CallRule<ArgumentPattern, Result, MatchKind, Behavior> {
    return { behavior, criterion };
}

export function createCallbackRuleTerminator<
    ArgumentPattern extends readonly unknown[],
    MatchKind extends 'arguments' | 'index'
>(
    criterion: CallRule<ArgumentPattern, unknown, MatchKind>['criterion']
): CallbackRuleTerminator<ArgumentPattern, MatchKind> {
    function callsCallback<const Index extends number, const CallbackArguments extends readonly unknown[], Result>(
        index: Index,
        callbackArguments: CallbackArguments,
        returnValue: Result
    ): CallRule<
        ArgumentPattern,
        Result,
        MatchKind,
        CallbackRuntimeBehavior<Index, CallbackArguments, Result, undefined, 'calls-callback'>
    >;
    function callsCallback<
        const Index extends number,
        const CallbackArguments extends readonly unknown[],
        Result,
        Receiver
    >(
        index: Index,
        callbackArguments: CallbackArguments,
        returnValue: Result,
        receiver: Receiver
    ): CallRule<
        ArgumentPattern,
        Result,
        MatchKind,
        CallbackRuntimeBehavior<Index, CallbackArguments, Result, Receiver, 'calls-callback'>
    >;
    function callsCallback(
        index: number,
        callbackArguments: readonly unknown[],
        returnValue: unknown,
        ...receiver: readonly [] | readonly [unknown]
    ): CallRule<
        ArgumentPattern,
        unknown,
        MatchKind,
        CallbackRuntimeBehavior<number, readonly unknown[], unknown, unknown, 'calls-callback'>
    > {
        const behavior = receiver.length === 0
            ? callsCallbackBehavior(index, callbackArguments, returnValue)
            : callsCallbackBehavior(index, callbackArguments, returnValue, receiver[0]);

        return callRule(criterion, behavior);
    }

    return callsCallback;
}

export function createAsyncCallbackRuleTerminator<
    ArgumentPattern extends readonly unknown[],
    MatchKind extends 'arguments' | 'index'
>(
    criterion: CallRule<ArgumentPattern, unknown, MatchKind>['criterion']
): CallbackRuleTerminator<ArgumentPattern, MatchKind, 'calls-callback-async'> {
    function callsCallbackAsync<
        const Index extends number,
        const CallbackArguments extends readonly unknown[],
        Result
    >(
        index: Index,
        callbackArguments: CallbackArguments,
        returnValue: Result
    ): CallRule<
        ArgumentPattern,
        Result,
        MatchKind,
        CallbackRuntimeBehavior<Index, CallbackArguments, Result, undefined, 'calls-callback-async'>
    >;
    function callsCallbackAsync<
        const Index extends number,
        const CallbackArguments extends readonly unknown[],
        Result,
        Receiver
    >(
        index: Index,
        callbackArguments: CallbackArguments,
        returnValue: Result,
        receiver: Receiver
    ): CallRule<
        ArgumentPattern,
        Result,
        MatchKind,
        CallbackRuntimeBehavior<Index, CallbackArguments, Result, Receiver, 'calls-callback-async'>
    >;
    function callsCallbackAsync(
        index: number,
        callbackArguments: readonly unknown[],
        returnValue: unknown,
        ...receiver: readonly [] | readonly [unknown]
    ): CallRule<
        ArgumentPattern,
        unknown,
        MatchKind,
        CallbackRuntimeBehavior<number, readonly unknown[], unknown, unknown, 'calls-callback-async'>
    > {
        const behavior = receiver.length === 0
            ? callsCallbackAsyncBehavior(index, callbackArguments, returnValue)
            : callsCallbackAsyncBehavior(index, callbackArguments, returnValue, receiver[0]);

        return callRule(criterion, behavior);
    }

    return callsCallbackAsync;
}

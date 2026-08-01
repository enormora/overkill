import type { CallableSignature } from './double-behavior.ts';
import type { DoubleIteratorEvent } from './double-history-record.ts';

type CallReturn<Signature> = Signature extends (...arguments_: readonly never[]) => infer ReturnValue ? ReturnValue
    : never;

type GeneratorLikeKind = keyof {
    readonly async: unknown;
    readonly sync: unknown;
};
type GeneratorLike<YieldValue, ReturnValue, NextValue> = {
    readonly async: AsyncGenerator<YieldValue, ReturnValue, NextValue>;
    readonly sync: Generator<YieldValue, ReturnValue, NextValue>;
}[GeneratorLikeKind];
type IterableLike<YieldValue> = AsyncIterableIterator<YieldValue> | IterableIterator<YieldValue>;

type IteratorEventArgumentCases<NextValue, ReturnValue> = {
    readonly empty: readonly [];
    readonly next: readonly [NextValue];
    readonly returned: readonly [ReturnValue];
    readonly unknown: readonly [unknown];
};

type IteratorEventArguments<NextValue, ReturnValue> = IteratorEventArgumentCases<
    NextValue,
    ReturnValue
>[keyof IteratorEventArgumentCases<NextValue, ReturnValue>];

type GeneratorIteratorEvent<ReturnValue> = ReturnValue extends GeneratorLike<
    infer YieldValue,
    infer GeneratorReturnValue,
    infer NextValue
> ? DoubleIteratorEvent<YieldValue, GeneratorReturnValue, IteratorEventArguments<NextValue, GeneratorReturnValue>>
    : never;

type IterableIteratorEvent<ReturnValue> = ReturnValue extends IterableLike<infer YieldValue>
    ? DoubleIteratorEvent<YieldValue>
    : DoubleIteratorEvent;

type IteratorEventForReturn<ReturnValue> = [GeneratorIteratorEvent<ReturnValue>] extends [never]
    ? IterableIteratorEvent<ReturnValue>
    : GeneratorIteratorEvent<ReturnValue>;

export type IteratorEventFor<Signature> = [Signature] extends [CallableSignature]
    ? IteratorEventForReturn<CallReturn<Signature>>
    : DoubleIteratorEvent;

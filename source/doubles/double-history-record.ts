import type {
    ConstructorReturnValue,
    InvocationKind
} from './double-behavior.ts';

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

export type DoubleIteratorProtocol = 'async' | 'sync';
export type DoubleIteratorMethod = 'next' | 'return' | 'throw';

type DoubleIteratorEventBase<
    Protocol extends DoubleIteratorProtocol = DoubleIteratorProtocol,
    Arguments extends readonly unknown[] = readonly unknown[]
> = {
    readonly arguments: Arguments;
    readonly callIndex: number;
    readonly index: number;
    readonly iteratorIndex: number;
    readonly method: DoubleIteratorMethod;
    readonly protocol: Protocol;
};

export type DoubleIteratorYieldEvent<
    YieldValue = unknown,
    NextArguments extends readonly unknown[] = readonly unknown[]
> = DoubleIteratorEventBase<DoubleIteratorProtocol, NextArguments> & {
    readonly kind: 'yield';
    readonly value: YieldValue;
};

export type DoubleIteratorReturnEvent<
    ReturnValue = unknown,
    NextArguments extends readonly unknown[] = readonly unknown[]
> = DoubleIteratorEventBase<DoubleIteratorProtocol, NextArguments> & {
    readonly kind: 'return';
    readonly value: ReturnValue;
};

export type DoubleIteratorThrowEvent<
    NextArguments extends readonly unknown[] = readonly unknown[]
> = DoubleIteratorEventBase<DoubleIteratorProtocol, NextArguments> & {
    readonly kind: 'throw';
    readonly thrown: unknown;
};

type DoubleIteratorEventKind = keyof {
    readonly return: unknown;
    readonly throw: unknown;
    readonly yield: unknown;
};

export type DoubleIteratorEvent<
    YieldValue = unknown,
    ReturnValue = unknown,
    NextArguments extends readonly unknown[] = readonly unknown[]
> = {
    readonly return: DoubleIteratorReturnEvent<ReturnValue, NextArguments>;
    readonly throw: DoubleIteratorThrowEvent<NextArguments>;
    readonly yield: DoubleIteratorYieldEvent<YieldValue, NextArguments>;
}[DoubleIteratorEventKind];

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

export type HistoryInvocation<Kind extends InvocationKind = InvocationKind> = {
    readonly arguments: readonly unknown[];
    readonly index: number;
    readonly kind: Kind;
    readonly order: number;
};

export function copyResult(result: DoubleResult): DoubleResult {
    return { ...result };
}

export function copyIteratorEvent(event: DoubleIteratorEvent): DoubleIteratorEvent {
    return {
        ...event,
        arguments: Array.from(event.arguments)
    };
}

export function copyCall(call: DoubleCall): DoubleCall {
    return {
        ...call,
        arguments: Array.from(call.arguments),
        result: copyResult(call.result)
    };
}

export function copyConstruction(construction: DoubleConstruction): DoubleConstruction {
    return {
        ...construction,
        arguments: Array.from(construction.arguments),
        result: copyResult(construction.result)
    };
}

export function copyInteraction(interaction: DoubleInteraction): DoubleInteraction {
    return interaction.kind === 'call' ? copyCall(interaction) : copyConstruction(interaction);
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

export function createCallRecord(
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

export function createConstructionRecord(
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

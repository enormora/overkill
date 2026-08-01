import {
    type BehaviorMode,
    type CallableSignature,
    callsBehavior,
    type ConstructorSignature,
    constructsBehavior,
    rejectsBehavior,
    resolvesBehavior,
    type RuntimeBehavior,
    type RuntimeRule,
    returnsBehavior,
    sequenceBehavior,
    throwsBehavior,
    type UnknownConstructor,
    type UnknownFunction
} from './double-behavior.ts';

type PrimitiveValue = bigint | boolean | number | string | symbol | null | undefined;
type VoidReturn = ReturnType<() => void>;

type FixedReturnValue<SignatureOrValue> = SignatureOrValue extends CallableSignature ? ReturnType<SignatureOrValue>
    : SignatureOrValue;

export type ReturnSignature<SignatureOrValue> = SignatureOrValue extends CallableSignature ? SignatureOrValue
    : UnknownFunction<SignatureOrValue>;

type CallableReturnArguments<Signature extends CallableSignature> = ReturnType<Signature> extends VoidReturn
    ? readonly [] | readonly [ReturnType<Signature>]
    : readonly [ReturnType<Signature>];

export type ReturnArguments<SignatureOrValue> = SignatureOrValue extends CallableSignature
    ? CallableReturnArguments<SignatureOrValue>
    : readonly [FixedReturnValue<SignatureOrValue>];

type PromiseResolution<Value> = Value extends Promise<infer Resolved> ? Resolved : never;

export type ResolvedValue<SignatureOrValue> = SignatureOrValue extends CallableSignature
    ? PromiseResolution<ReturnType<SignatureOrValue>>
    : Awaited<SignatureOrValue>;

type AsyncCallableSignature<Signature extends CallableSignature> = ReturnType<Signature> extends Promise<unknown>
    ? Signature
    : never;

export type ResolvedSignature<SignatureOrValue> = SignatureOrValue extends CallableSignature
    ? AsyncCallableSignature<SignatureOrValue>
    : UnknownFunction<Promise<Awaited<SignatureOrValue>>>;

type NonPrimitiveInstance<SignatureOrInstance> = SignatureOrInstance extends PrimitiveValue ? never
    : SignatureOrInstance;

export type ConstructInstance<SignatureOrInstance> = SignatureOrInstance extends ConstructorSignature
    ? InstanceType<SignatureOrInstance>
    : NonPrimitiveInstance<SignatureOrInstance>;

export type ConstructSignature<SignatureOrInstance> = SignatureOrInstance extends ConstructorSignature
    ? SignatureOrInstance
    : UnknownConstructor<SignatureOrInstance>;

type BuiltInPartialValue = Date | Error | Promise<unknown> | RegExp;

type DeepPartialValue<Value> = Value extends PrimitiveValue ? Value : DeepPartialReference<Value>;

type DeepPartialReference<Value> = Value extends CallableSignature ? Value : DeepPartialBuiltIn<Value>;

type DeepPartialBuiltIn<Value> = Value extends BuiltInPartialValue ? Value : DeepPartialMap<Value>;

type DeepPartialMapValue<Key, EntryValue> = ReadonlyMap<DeepPartialValue<Key>, DeepPartialValue<EntryValue>>;

type DeepPartialMap<Value> = Value extends ReadonlyMap<infer Key, infer EntryValue>
    ? DeepPartialMapValue<Key, EntryValue>
    : DeepPartialSet<Value>;

type DeepPartialSet<Value> = Value extends ReadonlySet<infer EntryValue> ? ReadonlySet<DeepPartialValue<EntryValue>>
    : DeepPartialArray<Value>;

type DeepPartialArrayValue<EntryValue> = readonly DeepPartialValue<EntryValue>[];

type DeepPartialArray<Value> = Value extends readonly (infer EntryValue)[] ? DeepPartialArrayValue<EntryValue>
    : DeepPartialObject<Value>;

type DeepPartialObject<Value> = Value extends Readonly<Record<PropertyKey, unknown>>
    ? { readonly [Key in keyof Value]?: DeepPartialValue<Value[Key]>; }
    : Value;

type TuplePrefix<Arguments extends readonly unknown[]> = Arguments extends readonly [infer First, ...infer Rest]
    ? readonly [DeepPartialValue<First>, ...TuplePrefix<Rest>] | readonly [DeepPartialValue<First>]
    : never;

type NonEmptyArgumentPatterns<Arguments extends readonly unknown[]> = number extends Arguments['length']
    ? readonly [DeepPartialValue<Arguments[number]>, ...DeepPartialValue<Arguments[number]>[]]
    : TuplePrefix<Arguments>;

export type CallArguments<Signature> = Signature extends (...arguments_: infer Arguments) => unknown ? Arguments
    : never;
export type ConstructionArguments<Signature> = Signature extends new (...arguments_: infer Arguments) => unknown
    ? Arguments
    : never;
export type CallReturn<Signature> = Signature extends (...arguments_: readonly never[]) => infer ReturnValue
    ? ReturnValue
    : never;
export type ConstructionInstance<Signature> = Signature extends new (
    ...arguments_: readonly never[]
) => infer Instance ? Instance
    : never;

type CallBehavior<Result = unknown> = RuntimeBehavior<'call', Result>;
type ConstructionBehavior<Result = unknown> = RuntimeBehavior<'construction', Result>;
type SharedBehavior<Result = never> = RuntimeBehavior<'both', Result>;

type CallRule<
    ArgumentPattern extends readonly unknown[],
    Result,
    MatchKind extends 'arguments' | 'index'
> = RuntimeRule<'call', ArgumentPattern, Result, MatchKind>;

type ConstructionRule<
    ArgumentPattern extends readonly unknown[],
    Result,
    MatchKind extends 'arguments' | 'index'
> = RuntimeRule<'construction', ArgumentPattern, Result, MatchKind>;

type CallRuleSupport<Signature> = [Signature] extends [CallableSignature] ? 'callable' : 'unsupported';

type CallRuleBySupport<Signature> = {
    readonly callable: CallRuleForSignature<Signature>;
    readonly unsupported: never;
};

type CallRuleFor<Signature> = CallRuleBySupport<Signature>[CallRuleSupport<Signature>];

type ArgumentCallRuleFor<Signature> = CallRule<
    NonEmptyArgumentPatterns<CallArguments<Signature>>,
    CallReturn<Signature>,
    'arguments'
>;

type IndexedCallRuleFor<Signature> = CallRule<readonly unknown[], CallReturn<Signature>, 'index'>;

type CallRuleForSignature<Signature> = ArgumentCallRuleFor<Signature> | IndexedCallRuleFor<Signature>;

type ConstructionRuleSupport<Signature> = [Signature] extends [ConstructorSignature] ? 'constructable'
    : 'unsupported';

type ConstructionRuleBySupport<Signature> = {
    readonly constructable: ConstructionRuleForSignature<Signature>;
    readonly unsupported: never;
};

type ConstructionRuleFor<Signature> = ConstructionRuleBySupport<Signature>[ConstructionRuleSupport<Signature>];

type ArgumentConstructionRuleFor<Signature> = ConstructionRule<
    NonEmptyArgumentPatterns<ConstructionArguments<Signature>>,
    ConstructionInstance<Signature>,
    'arguments'
>;

type IndexedConstructionRuleFor<Signature> = ConstructionRule<
    readonly unknown[],
    ConstructionInstance<Signature>,
    'index'
>;

type ConstructionRuleForSignature<Signature> = {
    readonly arguments: ArgumentConstructionRuleFor<Signature>;
    readonly index: IndexedConstructionRuleFor<Signature>;
}[
    keyof {
        readonly arguments: unknown;
        readonly index: unknown;
    }
];

export type DoubleRuleFor<Signature> = CallRuleFor<Signature> | ConstructionRuleFor<Signature>;

type CallFallbackSupport<Signature> = [Signature] extends [CallableSignature] ? 'callable' : 'unsupported';

type CallFallbackBySupport<Signature> = {
    readonly callable: CallFallbackForSignature<Signature>;
    readonly unsupported: never;
};

type CallFallbackFor<Signature> = CallFallbackBySupport<Signature>[CallFallbackSupport<Signature>];

type CallFallbackForSignature<Signature> = RuntimeBehavior<BehaviorMode, CallReturn<Signature>> | SharedBehavior;

type ConstructionBehaviorFallbackFor<Signature> = RuntimeBehavior<BehaviorMode, ConstructionInstance<Signature>>;

type ConstructionFallbackForSignature<Signature> = ConstructionBehaviorFallbackFor<Signature> | SharedBehavior;

type ConstructionFallbackSupport<Signature> = [Signature] extends [ConstructorSignature] ? 'constructable'
    : 'unsupported';

type ConstructionFallbackBySupport<Signature> = {
    readonly constructable: ConstructionFallbackForSignature<Signature>;
    readonly unsupported: never;
};

type ConstructionFallbackFor<Signature> = ConstructionFallbackBySupport<
    Signature
>[ConstructionFallbackSupport<Signature>];

type FallbackModeSupport<Signature> = [Signature] extends [CallableSignature] ? 'callable' : 'unsupported';

type FallbackByModeSupport<Signature> = {
    readonly callable: FallbackByCallableMode<Signature>;
    readonly unsupported: never;
};

type FallbackByMode<Signature> = FallbackByModeSupport<Signature>[FallbackModeSupport<Signature>];

type CallableFallbackModeSupport<Signature> = [Signature] extends [ConstructorSignature] ? 'constructable'
    : 'unsupported';

type FallbackByCallableModeSupport<Signature> = {
    readonly constructable: FallbackModes<Signature>;
    readonly unsupported: never;
};

type FallbackByCallableMode<Signature> = FallbackByCallableModeSupport<
    Signature
>[CallableFallbackModeSupport<Signature>];

type FallbackModes<Signature> = {
    readonly call: CallFallbackFor<Signature>;
    readonly construction: ConstructionFallbackFor<Signature>;
};

type FallbackForSignature<Signature> = CallFallbackFor<Signature> | ConstructionFallbackFor<Signature>;

export type FallbackFor<Signature> = FallbackByMode<Signature> | FallbackForSignature<Signature>;

type SequenceEntries<Entry> = readonly [Entry, Entry, ...Entry[]];

type SequenceResult<Entry> = Entry extends RuntimeBehavior<BehaviorMode, infer Result> ? Result : Entry;

type ReturningBehaviorFactory = {
    (): CallBehavior<void>;
    <SignatureOrValue>(...value: ReturnArguments<SignatureOrValue>): CallBehavior<FixedReturnValue<SignatureOrValue>>;
};

type ResolvingBehaviorFactory = <SignatureOrValue>(
    value: ResolvedValue<SignatureOrValue>
) => CallBehavior<Promise<ResolvedValue<SignatureOrValue>>>;

type RejectingBehaviorFactory = {
    (reason: unknown): CallBehavior<Promise<never>>;
    <Signature extends CallableSignature>(
        reason: ReturnType<Signature> extends Promise<unknown> ? unknown : never
    ): CallBehavior<ReturnType<Signature>>;
};

type ThrowingBehaviorFactory = {
    (thrown: unknown): SharedBehavior;
    <Signature extends CallableSignature>(
        thrown: ReturnType<Signature> extends Promise<unknown> ? never : unknown
    ): SharedBehavior;
};

type ConstructingBehaviorFactory = <SignatureOrInstance>(
    instance: ConstructInstance<SignatureOrInstance>
) => ConstructionBehavior<ConstructInstance<SignatureOrInstance>>;

type CallingBehaviorFactory = <Answer extends UnknownFunction<unknown>>(
    answer: Answer
) => SharedBehavior<ReturnType<Answer>>;

type SequenceBehaviorFactory = <Entry>(
    entries: SequenceEntries<Entry>
) => RuntimeBehavior<BehaviorMode, SequenceResult<Entry>>;

type CallRuleStarter<ArgumentPattern extends readonly unknown[], MatchKind extends 'arguments' | 'index'> = {
    readonly calls: <Answer extends UnknownFunction<unknown>>(
        answer: Answer
    ) => CallRule<ArgumentPattern, ReturnType<Answer>, MatchKind>;
    readonly rejects: RejectingRuleTerminator<ArgumentPattern, MatchKind>;
    readonly resolves: ResolvingRuleTerminator<ArgumentPattern, MatchKind>;
    readonly returns: ReturningRuleTerminator<ArgumentPattern, MatchKind>;
    readonly sequence: <Entry>(
        entries: SequenceEntries<Entry>
    ) => CallRule<ArgumentPattern, SequenceResult<Entry>, MatchKind>;
    readonly throws: (thrown: unknown) => CallRule<ArgumentPattern, never, MatchKind>;
};

type ConstructionRuleStarter<
    ArgumentPattern extends readonly unknown[],
    MatchKind extends 'arguments' | 'index'
> = {
    readonly calls: <Answer extends UnknownFunction<unknown>>(
        answer: Answer
    ) => ConstructionRule<ArgumentPattern, ReturnType<Answer>, MatchKind>;
    readonly constructs: <SignatureOrInstance>(
        instance: ConstructInstance<SignatureOrInstance>
    ) => ConstructionRule<ArgumentPattern, ConstructInstance<SignatureOrInstance>, MatchKind>;
    readonly sequence: <Entry>(
        entries: SequenceEntries<Entry>
    ) => ConstructionRule<ArgumentPattern, SequenceResult<Entry>, MatchKind>;
    readonly throws: (thrown: unknown) => ConstructionRule<ArgumentPattern, never, MatchKind>;
};

type ReturningRuleTerminator<ArgumentPattern extends readonly unknown[], MatchKind extends 'arguments' | 'index'> = {
    (): CallRule<ArgumentPattern, void, MatchKind>;
    <SignatureOrValue>(...value: ReturnArguments<SignatureOrValue>): CallRule<
        ArgumentPattern,
        FixedReturnValue<SignatureOrValue>,
        MatchKind
    >;
};

type ResolvingRuleTerminator<ArgumentPattern extends readonly unknown[], MatchKind extends 'arguments' | 'index'> = <
    SignatureOrValue
>(
    value: ResolvedValue<SignatureOrValue>
) => CallRule<ArgumentPattern, Promise<ResolvedValue<SignatureOrValue>>, MatchKind>;

type RejectingRuleTerminator<ArgumentPattern extends readonly unknown[], MatchKind extends 'arguments' | 'index'> = {
    (reason: unknown): CallRule<ArgumentPattern, Promise<never>, MatchKind>;
    <Signature extends CallableSignature>(
        reason: ReturnType<Signature> extends Promise<unknown> ? unknown : never
    ): CallRule<ArgumentPattern, ReturnType<Signature>, MatchKind>;
};

export type RuleFactory = {
    readonly calls: CallingBehaviorFactory;
    readonly constructs: ConstructingBehaviorFactory;
    readonly onCall: (index: number) => CallRuleStarter<readonly unknown[], 'index'>;
    readonly onConstruction: (index: number) => ConstructionRuleStarter<readonly unknown[], 'index'>;
    readonly rejects: RejectingBehaviorFactory;
    readonly resolves: ResolvingBehaviorFactory;
    readonly returns: ReturningBehaviorFactory;
    readonly sequence: SequenceBehaviorFactory;
    readonly throws: ThrowingBehaviorFactory;
    readonly when: <ExpectedArguments extends readonly [unknown, ...(readonly unknown[])]>(
        ...expectedArguments: ExpectedArguments
    ) => CallRuleStarter<ExpectedArguments, 'arguments'>;
    readonly whenConstructedWith: <ExpectedArguments extends readonly [unknown, ...(readonly unknown[])]>(
        ...expectedArguments: ExpectedArguments
    ) => ConstructionRuleStarter<ExpectedArguments, 'arguments'>;
};

function callRule<ArgumentPattern extends readonly unknown[], Result, MatchKind extends 'arguments' | 'index'>(
    criterion: CallRule<ArgumentPattern, Result, MatchKind>['criterion'],
    behavior: RuntimeBehavior<BehaviorMode, Result>
): CallRule<ArgumentPattern, Result, MatchKind> {
    return { behavior, criterion };
}

function constructionRule<ArgumentPattern extends readonly unknown[], Result, MatchKind extends 'arguments' | 'index'>(
    criterion: ConstructionRule<ArgumentPattern, Result, MatchKind>['criterion'],
    behavior: RuntimeBehavior<BehaviorMode, Result>
): ConstructionRule<ArgumentPattern, Result, MatchKind> {
    return { behavior, criterion };
}

function createCallRuleStarter<ArgumentPattern extends readonly unknown[], MatchKind extends 'arguments' | 'index'>(
    criterion: CallRule<ArgumentPattern, unknown, MatchKind>['criterion']
): CallRuleStarter<ArgumentPattern, MatchKind> {
    return {
        calls(answer) {
            return callRule<ArgumentPattern, ReturnType<typeof answer>, MatchKind>(
                criterion,
                callsBehavior(answer)
            );
        },
        rejects(reason: unknown) {
            return callRule<ArgumentPattern, Promise<never>, MatchKind>(criterion, rejectsBehavior(reason));
        },
        resolves(value) {
            return callRule<ArgumentPattern, Promise<typeof value>, MatchKind>(criterion, resolvesBehavior(value));
        },
        returns(...value: readonly unknown[]) {
            return callRule<ArgumentPattern, unknown, MatchKind>(criterion, returnsBehavior(value[0]));
        },
        sequence(entries) {
            return callRule<ArgumentPattern, SequenceResult<typeof entries[number]>, MatchKind>(
                criterion,
                sequenceBehavior<SequenceResult<typeof entries[number]>>(entries)
            );
        },
        throws(thrown) {
            return callRule<ArgumentPattern, never, MatchKind>(criterion, throwsBehavior(thrown));
        }
    };
}

function createConstructionRuleStarter<
    ArgumentPattern extends readonly unknown[],
    MatchKind extends 'arguments' | 'index'
>(
    criterion: ConstructionRule<ArgumentPattern, unknown, MatchKind>['criterion']
): ConstructionRuleStarter<ArgumentPattern, MatchKind> {
    return {
        calls(answer) {
            return constructionRule<ArgumentPattern, ReturnType<typeof answer>, MatchKind>(
                criterion,
                callsBehavior(answer)
            );
        },
        constructs<SignatureOrInstance>(instance: ConstructInstance<SignatureOrInstance>) {
            return constructionRule<ArgumentPattern, ConstructInstance<SignatureOrInstance>, MatchKind>(
                criterion,
                constructsBehavior(instance)
            );
        },
        sequence(entries) {
            return constructionRule<ArgumentPattern, SequenceResult<typeof entries[number]>, MatchKind>(
                criterion,
                sequenceBehavior<SequenceResult<typeof entries[number]>>(entries)
            );
        },
        throws(thrown) {
            return constructionRule<ArgumentPattern, never, MatchKind>(criterion, throwsBehavior(thrown));
        }
    };
}

function createCallArgumentRuleStarter<ArgumentPattern extends readonly [unknown, ...unknown[]]>(
    ...expectedArguments: ArgumentPattern
): CallRuleStarter<ArgumentPattern, 'arguments'> {
    return createCallRuleStarter({
        expectedArguments,
        invocationKind: 'call',
        kind: 'arguments'
    });
}

function createConstructionArgumentRuleStarter<ArgumentPattern extends readonly [unknown, ...unknown[]]>(
    ...expectedArguments: ArgumentPattern
): ConstructionRuleStarter<ArgumentPattern, 'arguments'> {
    return createConstructionRuleStarter({
        expectedArguments,
        invocationKind: 'construction',
        kind: 'arguments'
    });
}

function validRuleIndex(index: number): number {
    if (!Number.isSafeInteger(index) || index < 0) {
        throw new TypeError('ordered double rules require a non-negative integer index.');
    }

    return index;
}

function createCallIndexRuleStarter(index: number): CallRuleStarter<readonly unknown[], 'index'> {
    return createCallRuleStarter({
        index: validRuleIndex(index),
        invocationKind: 'call',
        kind: 'index'
    });
}

function createConstructionIndexRuleStarter(index: number): ConstructionRuleStarter<readonly unknown[], 'index'> {
    return createConstructionRuleStarter({
        index: validRuleIndex(index),
        invocationKind: 'construction',
        kind: 'index'
    });
}

function createReturningBehavior(): CallBehavior<void>;
function createReturningBehavior<SignatureOrValue>(
    ...value: ReturnArguments<SignatureOrValue>
): CallBehavior<SignatureOrValue extends CallableSignature ? ReturnType<SignatureOrValue> : SignatureOrValue>;
function createReturningBehavior(...value: readonly unknown[]): CallBehavior {
    return returnsBehavior(value[0]);
}

export const rule: RuleFactory = {
    calls: callsBehavior,
    constructs: constructsBehavior,
    onCall: createCallIndexRuleStarter,
    onConstruction: createConstructionIndexRuleStarter,
    rejects: rejectsBehavior,
    resolves: resolvesBehavior,
    returns: createReturningBehavior,
    sequence: sequenceBehavior,
    throws: throwsBehavior,
    when: createCallArgumentRuleStarter,
    whenConstructedWith: createConstructionArgumentRuleStarter
};

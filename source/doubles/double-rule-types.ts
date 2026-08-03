import type {
    BehaviorMode,
    CallableSignature,
    CallbackBehaviorKind,
    ConstructorSignature,
    FixedBehaviorKind,
    RuntimeBehavior,
    RuntimeFixedBehavior,
    RuntimeRule,
    RuntimeSequenceBehavior,
    UnknownConstructor,
    UnknownFunction
} from './double-behavior.ts';
import type {
    CallbackBehaviorFactory,
    CallbackBehaviorFor,
    CallbackRuleTerminator
} from './double-rule-callback.ts';
import type { NonEmptyArgumentPatterns } from './double-rule-arguments.ts';
import type {
    AsyncYieldingBehaviorFactory,
    AsyncYieldingFromBehaviorFactory,
    AsyncYieldingFromRuleTerminator,
    AsyncYieldingRuleTerminator,
    YieldingBehaviorFactory,
    YieldingFromBehaviorFactory,
    YieldingFromRuleTerminator,
    YieldingRuleTerminator
} from './double-rule-generator.ts';
import type {
    CallArguments,
    CallReturn,
    ConstructionArguments,
    ConstructionInstance
} from './double-signature.ts';

type PrimitiveValue = bigint | boolean | number | string | symbol | null | undefined;
type VoidReturn = ReturnType<() => void>;
type NonCallbackBehaviorKind = Exclude<FixedBehaviorKind, CallbackBehaviorKind>;
type SharedBehavior<Result = never> = RuntimeFixedBehavior<'both', Result, NonCallbackBehaviorKind>;
type NonCallbackBehavior<Result> = RuntimeFixedBehavior<BehaviorMode, Result, NonCallbackBehaviorKind>;

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

export type CallRule<
    ArgumentPattern extends readonly unknown[],
    Result,
    MatchKind extends 'arguments' | 'index',
    Behavior extends RuntimeBehavior<BehaviorMode, Result> = RuntimeBehavior<BehaviorMode, Result>
> = RuntimeRule<'call', ArgumentPattern, Result, MatchKind, Behavior>;

export type ConstructionRule<
    ArgumentPattern extends readonly unknown[],
    Result,
    MatchKind extends 'arguments' | 'index',
    Behavior extends RuntimeBehavior<BehaviorMode, Result> = RuntimeBehavior<BehaviorMode, Result>
> = RuntimeRule<'construction', ArgumentPattern, Result, MatchKind, Behavior>;

type CallRuleSupport<Signature> = [Signature] extends [CallableSignature] ? 'callable' : 'unsupported';

type CallRuleBySupport<Signature> = {
    readonly callable: CallRuleForSignature<Signature>;
    readonly unsupported: never;
};

type CallRuleFor<Signature> = CallRuleBySupport<Signature>[CallRuleSupport<Signature>];

type CallSequenceEntryByKind<Signature> = {
    readonly callback: CallbackBehaviorFor<Signature>;
    readonly fixed: NonCallbackBehavior<CallReturn<Signature>>;
    readonly value: CallReturn<Signature>;
};

type CallSequenceEntryFor<Signature> = CallSequenceEntryByKind<Signature>[keyof CallSequenceEntryByKind<Signature>];

type CallSequenceFor<Signature> = RuntimeSequenceBehavior<
    BehaviorMode,
    CallReturn<Signature>,
    readonly [CallSequenceEntryFor<Signature>, CallSequenceEntryFor<Signature>, ...CallSequenceEntryFor<Signature>[]]
>;

type CallBehaviorByKind<Signature> = {
    readonly callback: CallbackBehaviorFor<Signature>;
    readonly fixed: NonCallbackBehavior<CallReturn<Signature>>;
    readonly sequence: CallSequenceFor<Signature>;
};

type CallBehaviorFor<Signature> = CallBehaviorByKind<Signature>[keyof CallBehaviorByKind<Signature>];

type ArgumentCallRuleFor<Signature> = CallRule<
    NonEmptyArgumentPatterns<CallArguments<Signature>>,
    CallReturn<Signature>,
    'arguments',
    CallBehaviorFor<Signature>
>;

type IndexedCallRuleFor<Signature> = CallRule<
    readonly unknown[],
    CallReturn<Signature>,
    'index',
    CallBehaviorFor<Signature>
>;

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

type CallFallbackForSignature<Signature> = CallBehaviorFor<Signature> | SharedBehavior;

type ConstructionBehaviorFallbackFor<Signature> = RuntimeBehavior<
    BehaviorMode,
    ConstructionInstance<Signature>,
    NonCallbackBehaviorKind
>;

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

type SequenceEntries = readonly [unknown, unknown, ...unknown[]];

export type SequenceResult<Entry> = Entry extends RuntimeBehavior<BehaviorMode, infer Result> ? Result : Entry;

type ReturningBehaviorFactory = {
    (): RuntimeFixedBehavior<'call', void, 'returns'>;
    <SignatureOrValue>(
        ...value: ReturnArguments<SignatureOrValue>
    ): RuntimeFixedBehavior<'call', FixedReturnValue<SignatureOrValue>, 'returns'>;
};

type ResolvingBehaviorFactory = <SignatureOrValue>(
    value: ResolvedValue<SignatureOrValue>
) => RuntimeFixedBehavior<'call', Promise<ResolvedValue<SignatureOrValue>>, 'resolves'>;

type RejectingBehaviorFactory = {
    (reason: unknown): RuntimeFixedBehavior<'call', Promise<never>, 'rejects'>;
    <Signature extends CallableSignature>(
        reason: ReturnType<Signature> extends Promise<unknown> ? unknown : never
    ): RuntimeFixedBehavior<'call', ReturnType<Signature>, 'rejects'>;
};

type ThrowingBehaviorFactory = {
    (thrown: unknown): RuntimeFixedBehavior<'both', never, 'throws'>;
    <Signature extends CallableSignature>(
        thrown: ReturnType<Signature> extends Promise<unknown> ? never : unknown
    ): RuntimeFixedBehavior<'both', never, 'throws'>;
};

type ConstructingBehaviorFactory = <SignatureOrInstance>(
    instance: ConstructInstance<SignatureOrInstance>
) => RuntimeFixedBehavior<'construction', ConstructInstance<SignatureOrInstance>, 'constructs'>;

type CallingBehaviorFactory = <Answer extends UnknownFunction<unknown>>(
    answer: Answer
) => RuntimeFixedBehavior<'both', ReturnType<Answer>, 'calls'>;

type SequenceBehaviorFactory = <Entries extends SequenceEntries>(
    entries: Entries
) => RuntimeSequenceBehavior<BehaviorMode, SequenceResult<Entries[number]>, Entries>;

export type CallRuleStarter<ArgumentPattern extends readonly unknown[], MatchKind extends 'arguments' | 'index'> = {
    readonly calls: <Answer extends UnknownFunction<unknown>>(
        answer: Answer
    ) => CallRule<
        ArgumentPattern,
        ReturnType<Answer>,
        MatchKind,
        RuntimeFixedBehavior<'both', ReturnType<Answer>, 'calls'>
    >;
    readonly callsCallback: CallbackRuleTerminator<ArgumentPattern, MatchKind>;
    readonly callsCallbackAsync: CallbackRuleTerminator<ArgumentPattern, MatchKind, 'calls-callback-async'>;
    readonly rejects: RejectingRuleTerminator<ArgumentPattern, MatchKind>;
    readonly resolves: ResolvingRuleTerminator<ArgumentPattern, MatchKind>;
    readonly returns: ReturningRuleTerminator<ArgumentPattern, MatchKind>;
    readonly sequence: <Entries extends SequenceEntries>(
        entries: Entries
    ) => CallRule<
        ArgumentPattern,
        SequenceResult<Entries[number]>,
        MatchKind,
        RuntimeSequenceBehavior<BehaviorMode, SequenceResult<Entries[number]>, Entries>
    >;
    readonly throws: (
        thrown: unknown
    ) => CallRule<ArgumentPattern, never, MatchKind, RuntimeFixedBehavior<'both', never, 'throws'>>;
    readonly yields: YieldingRuleTerminator<ArgumentPattern, MatchKind>;
    readonly yieldsAsync: AsyncYieldingRuleTerminator<ArgumentPattern, MatchKind>;
    readonly yieldsAsyncFrom: AsyncYieldingFromRuleTerminator<ArgumentPattern, MatchKind>;
    readonly yieldsFrom: YieldingFromRuleTerminator<ArgumentPattern, MatchKind>;
};

export type ConstructionRuleStarter<
    ArgumentPattern extends readonly unknown[],
    MatchKind extends 'arguments' | 'index'
> = {
    readonly calls: <Answer extends UnknownFunction<unknown>>(
        answer: Answer
    ) => ConstructionRule<
        ArgumentPattern,
        ReturnType<Answer>,
        MatchKind,
        RuntimeFixedBehavior<'both', ReturnType<Answer>, 'calls'>
    >;
    readonly constructs: <SignatureOrInstance>(
        instance: ConstructInstance<SignatureOrInstance>
    ) => ConstructionRule<
        ArgumentPattern,
        ConstructInstance<SignatureOrInstance>,
        MatchKind,
        RuntimeFixedBehavior<'construction', ConstructInstance<SignatureOrInstance>, 'constructs'>
    >;
    readonly sequence: <Entries extends SequenceEntries>(
        entries: Entries
    ) => ConstructionRule<
        ArgumentPattern,
        SequenceResult<Entries[number]>,
        MatchKind,
        RuntimeSequenceBehavior<BehaviorMode, SequenceResult<Entries[number]>, Entries>
    >;
    readonly throws: (
        thrown: unknown
    ) => ConstructionRule<ArgumentPattern, never, MatchKind, RuntimeFixedBehavior<'both', never, 'throws'>>;
};

type ReturningRuleTerminator<ArgumentPattern extends readonly unknown[], MatchKind extends 'arguments' | 'index'> = {
    (): CallRule<ArgumentPattern, void, MatchKind, RuntimeFixedBehavior<'call', void, 'returns'>>;
    <SignatureOrValue>(...value: ReturnArguments<SignatureOrValue>): CallRule<
        ArgumentPattern,
        FixedReturnValue<SignatureOrValue>,
        MatchKind,
        RuntimeFixedBehavior<'call', FixedReturnValue<SignatureOrValue>, 'returns'>
    >;
};

type ResolvingRuleTerminator<ArgumentPattern extends readonly unknown[], MatchKind extends 'arguments' | 'index'> = <
    SignatureOrValue
>(
    value: ResolvedValue<SignatureOrValue>
) => CallRule<
    ArgumentPattern,
    Promise<ResolvedValue<SignatureOrValue>>,
    MatchKind,
    RuntimeFixedBehavior<'call', Promise<ResolvedValue<SignatureOrValue>>, 'resolves'>
>;

type RejectingRuleTerminator<ArgumentPattern extends readonly unknown[], MatchKind extends 'arguments' | 'index'> = {
    (
        reason: unknown
    ): CallRule<ArgumentPattern, Promise<never>, MatchKind, RuntimeFixedBehavior<'call', Promise<never>, 'rejects'>>;
    <Signature extends CallableSignature>(
        reason: ReturnType<Signature> extends Promise<unknown> ? unknown : never
    ): CallRule<
        ArgumentPattern,
        ReturnType<Signature>,
        MatchKind,
        RuntimeFixedBehavior<'call', ReturnType<Signature>, 'rejects'>
    >;
};

export type RuleFactory = {
    readonly calls: CallingBehaviorFactory;
    readonly callsCallback: CallbackBehaviorFactory;
    readonly callsCallbackAsync: CallbackBehaviorFactory;
    readonly constructs: ConstructingBehaviorFactory;
    readonly onCall: (index: number) => CallRuleStarter<readonly unknown[], 'index'>;
    readonly onConstruction: (index: number) => ConstructionRuleStarter<readonly unknown[], 'index'>;
    readonly rejects: RejectingBehaviorFactory;
    readonly resolves: ResolvingBehaviorFactory;
    readonly returns: ReturningBehaviorFactory;
    readonly sequence: SequenceBehaviorFactory;
    readonly throws: ThrowingBehaviorFactory;
    readonly yields: YieldingBehaviorFactory;
    readonly yieldsAsync: AsyncYieldingBehaviorFactory;
    readonly yieldsAsyncFrom: AsyncYieldingFromBehaviorFactory;
    readonly yieldsFrom: YieldingFromBehaviorFactory;
    readonly when: <ExpectedArguments extends readonly [unknown, ...(readonly unknown[])]>(
        ...expectedArguments: ExpectedArguments
    ) => CallRuleStarter<ExpectedArguments, 'arguments'>;
    readonly whenConstructedWith: <ExpectedArguments extends readonly [unknown, ...(readonly unknown[])]>(
        ...expectedArguments: ExpectedArguments
    ) => ConstructionRuleStarter<ExpectedArguments, 'arguments'>;
};

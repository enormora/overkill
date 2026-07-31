import type {
    BehaviorMode,
    CallableSignature,
    ConstructorSignature,
    DoubleInvocation,
    RuntimeBehavior,
    RuntimeRule,
    UnknownConstructor,
    UnknownFunction
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

type CallArguments<Signature> = Signature extends (...arguments_: infer Arguments) => unknown ? Arguments : never;
type ConstructionArguments<Signature> = Signature extends new (...arguments_: infer Arguments) => unknown ? Arguments
    : never;
type CallReturn<Signature> = Signature extends (...arguments_: readonly never[]) => infer ReturnValue ? ReturnValue
    : never;
type ConstructionInstance<Signature> = Signature extends new (...arguments_: readonly never[]) => infer Instance
    ? Instance
    : never;

export type CallBehavior<Result = unknown> = RuntimeBehavior<'call', Result>;
type ConstructionBehavior<Result = unknown> = RuntimeBehavior<'construction', Result>;
type SharedBehavior<Result = never> = RuntimeBehavior<'both', Result>;

export type CallRule<
    ArgumentPattern extends readonly unknown[],
    Result,
    MatchKind extends 'arguments' | 'index'
> = RuntimeRule<'call', ArgumentPattern, Result, MatchKind>;

export type ConstructionRule<
    ArgumentPattern extends readonly unknown[],
    Result,
    MatchKind extends 'arguments' | 'index'
> = RuntimeRule<'construction', ArgumentPattern, Result, MatchKind>;

type CallRuleFor<Signature> = Signature extends CallableSignature ? CallRuleForSignature<Signature>
    : never;

type CallRuleByMatch<Signature> = {
    readonly arguments: CallRule<
        NonEmptyArgumentPatterns<CallArguments<Signature>>,
        CallReturn<Signature>,
        'arguments'
    >;
    readonly index: CallRule<readonly unknown[], CallReturn<Signature>, 'index'>;
};

type CallRuleForSignature<Signature> = CallRuleByMatch<Signature>[keyof CallRuleByMatch<Signature>];

type ConstructionRuleFor<Signature> = Signature extends ConstructorSignature ? ConstructionRuleForSignature<Signature>
    : never;

type ConstructionRuleByMatch<Signature> = {
    readonly arguments: ConstructionRule<
        NonEmptyArgumentPatterns<ConstructionArguments<Signature>>,
        ConstructionInstance<Signature>,
        'arguments'
    >;
    readonly index: ConstructionRule<readonly unknown[], ConstructionInstance<Signature>, 'index'>;
};

type ConstructionRuleForSignature<Signature> = ConstructionRuleByMatch<
    Signature
>[keyof ConstructionRuleByMatch<Signature>];

type DoubleRuleFor<Signature> = CallRuleFor<Signature> | ConstructionRuleFor<Signature>;

type CallFallbackFor<Signature> = Signature extends CallableSignature ? CallFallbackForSignature<Signature>
    : never;

type CallFallbackForSignature<Signature> = RuntimeBehavior<BehaviorMode, CallReturn<Signature>> | SharedBehavior;

type ConstructionFallbackFor<Signature> = Signature extends ConstructorSignature
    ? ConstructionFallbackForSignature<Signature>
    : never;

type ConstructionFallbackByMode<Signature> = {
    readonly construction: RuntimeBehavior<BehaviorMode, ConstructionInstance<Signature>>;
    readonly shared: SharedBehavior;
};

type ConstructionFallbackForSignature<Signature> = ConstructionFallbackByMode<
    Signature
>[keyof ConstructionFallbackByMode<Signature>];

type FallbackByMode<Signature> = Signature extends CallableSignature ? FallbackByCallableMode<Signature>
    : never;

type FallbackByCallableMode<Signature> = Signature extends ConstructorSignature ? FallbackModes<Signature> : never;

type FallbackModes<Signature> = {
    readonly call: CallFallbackFor<Signature>;
    readonly construction: ConstructionFallbackFor<Signature>;
};

type FallbackVariants<Signature> = {
    readonly call: CallFallbackFor<Signature>;
    readonly construction: ConstructionFallbackFor<Signature>;
    readonly modes: FallbackByMode<Signature>;
};

type FallbackFor<Signature> = FallbackVariants<Signature>[keyof FallbackVariants<Signature>];

type CallableInvocationFor<Signature> = Signature extends CallableSignature ? DoubleInvocation<CallArguments<Signature>>
    : never;

type ConstructionInvocationFor<Signature> = Signature extends ConstructorSignature
    ? DoubleInvocation<ConstructionArguments<Signature>>
    : never;

type InvocationFor<Signature> = CallableInvocationFor<Signature> | ConstructionInvocationFor<Signature>;

type AnswerReturn<Signature> = CallReturn<Signature> | ConstructionInstance<Signature>;

type RuleConfiguration<Signature> = {
    readonly rules?: readonly DoubleRuleFor<Signature>[];
};

type AnswerConfiguration<Signature> = RuleConfiguration<Signature> & {
    readonly answer: (invocation: InvocationFor<Signature>) => AnswerReturn<Signature>;
    readonly fallback?: never;
};

type FallbackConfiguration<Signature> = RuleConfiguration<Signature> & {
    readonly answer?: never;
    readonly fallback?: FallbackFor<Signature>;
};

type TestDoubleConfigurationVariants<Signature> = {
    readonly answer: AnswerConfiguration<Signature>;
    readonly fallback: FallbackConfiguration<Signature>;
};

export type TestDoubleConfiguration<Signature> = TestDoubleConfigurationVariants<
    Signature
>[keyof TestDoubleConfigurationVariants<Signature>];

type SequenceEntries<Entry> = readonly [Entry, Entry, ...Entry[]];

export type SequenceResult<Entry> = Entry extends RuntimeBehavior<BehaviorMode, infer Result> ? Result : Entry;

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

export type CallRuleStarter<ArgumentPattern extends readonly unknown[], MatchKind extends 'arguments' | 'index'> = {
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

export type ConstructionRuleStarter<
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

export type TestDouble<Signature> = Signature;

export type TestDoubleFactory = {
    <Signature extends CallableSignature | ConstructorSignature = UnknownFunction<unknown>>(
        ...configuration: Signature extends ConstructorSignature ? readonly [TestDoubleConfiguration<Signature>]
            : readonly [] | readonly [TestDoubleConfiguration<Signature>]
    ): TestDouble<Signature>;
    readonly constructs: <SignatureOrInstance>(
        instance: ConstructInstance<SignatureOrInstance>
    ) => TestDouble<ConstructSignature<SignatureOrInstance>>;
    readonly rejects: {
        (reason: unknown): TestDouble<UnknownFunction<Promise<never>>>;
        <Signature extends CallableSignature>(
            reason: ReturnType<Signature> extends Promise<unknown> ? unknown : never
        ): TestDouble<Signature>;
    };
    readonly resolves: <SignatureOrValue>(
        value: ResolvedValue<SignatureOrValue>
    ) => TestDouble<ResolvedSignature<SignatureOrValue>>;
    readonly returns: <SignatureOrValue>(
        ...value: ReturnArguments<SignatureOrValue>
    ) => TestDouble<ReturnSignature<SignatureOrValue>>;
    readonly throws: {
        (thrown: unknown): TestDouble<UnknownFunction<never>>;
        <Signature extends CallableSignature>(
            thrown: ReturnType<Signature> extends Promise<unknown> ? never : unknown
        ): TestDouble<Signature>;
    };
};

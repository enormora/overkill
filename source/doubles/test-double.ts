import { comparePartially } from '../compare/raw-comparison.ts';

type CallableSignature = (...arguments_: readonly never[]) => unknown;
type ConstructorSignature = new (...arguments_: readonly never[]) => unknown;
type PrimitiveValue = bigint | boolean | number | string | symbol | null | undefined;
type UnknownFunction<Result> = (...arguments_: readonly unknown[]) => Result;
type UnknownConstructor<Instance> = new (...arguments_: readonly unknown[]) => Instance;
type VoidReturn = ReturnType<() => void>;

type FixedReturnValue<SignatureOrValue> = SignatureOrValue extends CallableSignature ? ReturnType<SignatureOrValue>
    : SignatureOrValue;

type ReturnSignature<SignatureOrValue> = SignatureOrValue extends CallableSignature ? SignatureOrValue
    : UnknownFunction<SignatureOrValue>;

type CallableReturnArguments<Signature extends CallableSignature> = ReturnType<Signature> extends VoidReturn
    ? readonly [] | readonly [ReturnType<Signature>]
    : readonly [ReturnType<Signature>];

type ReturnArguments<SignatureOrValue> = SignatureOrValue extends CallableSignature
    ? CallableReturnArguments<SignatureOrValue>
    : readonly [FixedReturnValue<SignatureOrValue>];

type PromiseResolution<Value> = Value extends Promise<infer Resolved> ? Resolved
    : never;

type ResolvedValue<SignatureOrValue> = SignatureOrValue extends CallableSignature
    ? PromiseResolution<ReturnType<SignatureOrValue>>
    : Awaited<SignatureOrValue>;

type AsyncCallableSignature<Signature extends CallableSignature> = ReturnType<Signature> extends Promise<unknown>
    ? Signature
    : never;

type ResolvedSignature<SignatureOrValue> = SignatureOrValue extends CallableSignature
    ? AsyncCallableSignature<SignatureOrValue>
    : UnknownFunction<Promise<Awaited<SignatureOrValue>>>;

type NonPrimitiveInstance<SignatureOrInstance> = SignatureOrInstance extends PrimitiveValue ? never
    : SignatureOrInstance;

type ConstructInstance<SignatureOrInstance> = SignatureOrInstance extends ConstructorSignature
    ? InstanceType<SignatureOrInstance>
    : NonPrimitiveInstance<SignatureOrInstance>;

type ConstructSignature<SignatureOrInstance> = SignatureOrInstance extends ConstructorSignature ? SignatureOrInstance
    : UnknownConstructor<SignatureOrInstance>;

type DeepPartialValue<Value> = Value extends PrimitiveValue ? Value
    : Value extends (...arguments_: readonly never[]) => unknown ? Value
        : Value extends Date | Error | Promise<unknown> | RegExp ? Value
            : Value extends ReadonlyMap<infer Key, infer EntryValue>
                ? ReadonlyMap<DeepPartialValue<Key>, DeepPartialValue<EntryValue>>
                : Value extends ReadonlySet<infer EntryValue> ? ReadonlySet<DeepPartialValue<EntryValue>>
                    : Value extends readonly (infer EntryValue)[] ? readonly DeepPartialValue<EntryValue>[]
                        : Value extends Record<string, unknown> ? { readonly [Key in keyof Value]?: DeepPartialValue<Value[Key]>; }
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

type RuleMatchKind = 'arguments' | 'index';

type RuleType<
    Kind extends InvocationKind,
    Result,
    ArgumentPattern extends readonly unknown[],
    MatchKind extends RuleMatchKind
> = {
    readonly __overkillRuleType: {
        readonly arguments: ArgumentPattern;
        readonly kind: Kind;
        readonly matchKind: MatchKind;
        readonly result: Result;
    };
};

type BehaviorType<Kind extends InvocationKind | 'both', Result, Arguments extends readonly unknown[]> = {
    readonly __overkillBehaviorType: {
        readonly arguments: Arguments;
        readonly kind: Kind;
        readonly result: Result;
    };
};

type CallBehavior<Result = unknown, Arguments extends readonly unknown[] = readonly unknown[]> =
    & BehaviorType<'call', Result, Arguments> &
    RuntimeBehavior;
type ConstructionBehavior<Result = unknown, Arguments extends readonly unknown[] = readonly unknown[]> =
    & BehaviorType<'construction', Result, Arguments> &
    RuntimeBehavior;
type SharedBehavior<Result = never, Arguments extends readonly unknown[] = readonly unknown[]> =
    & BehaviorType<'both', Result, Arguments> &
    RuntimeBehavior;

type CallRule<
    ArgumentPattern extends readonly unknown[],
    Result,
    MatchKind extends RuleMatchKind
> = RuleType<'call', Result, ArgumentPattern, MatchKind> & RuntimeRule;

type ConstructionRule<
    ArgumentPattern extends readonly unknown[],
    Result,
    MatchKind extends RuleMatchKind
> = RuleType<'construction', Result, ArgumentPattern, MatchKind> & RuntimeRule;

type CallRuleFor<Signature> = Signature extends CallableSignature ?
        | CallRule<NonEmptyArgumentPatterns<CallArguments<Signature>>, CallReturn<Signature>, 'arguments'>
        | CallRule<readonly unknown[], CallReturn<Signature>, 'index'>
    : never;

type ConstructionRuleFor<Signature> = Signature extends ConstructorSignature ?
        | ConstructionRule<
        NonEmptyArgumentPatterns<ConstructionArguments<Signature>>,
        ConstructionInstance<Signature>,
        'arguments'
    >
        | ConstructionRule<readonly unknown[], ConstructionInstance<Signature>, 'index'>
    : never;

type DoubleRuleFor<Signature> = CallRuleFor<Signature> | ConstructionRuleFor<Signature>;

type CallFallbackFor<Signature> = Signature extends CallableSignature ?
        | CallBehavior<CallReturn<Signature>>
        | SharedBehavior
    : never;

type ConstructionFallbackFor<Signature> = Signature extends ConstructorSignature ?
        | ConstructionBehavior<ConstructionInstance<Signature>>
        | SharedBehavior
    : never;

type FallbackByMode<Signature> = Signature extends CallableSignature ? Signature extends ConstructorSignature ? {
            readonly call: CallFallbackFor<Signature>;
            readonly construction: ConstructionFallbackFor<Signature>;
        }
    : never
    : never;

type FallbackFor<Signature> =
    | CallFallbackFor<Signature>
    | ConstructionFallbackFor<Signature>
    | FallbackByMode<Signature>;

type InvocationFor<Signature> =
    | (Signature extends CallableSignature ? DoubleInvocation<CallArguments<Signature>>
        : never)
    | (Signature extends ConstructorSignature ? DoubleInvocation<ConstructionArguments<Signature>> : never);

type AnswerReturn<Signature> = CallReturn<Signature> | ConstructionInstance<Signature>;

type TestDoubleConfiguration<Signature> =
    & {
        readonly rules?: readonly DoubleRuleFor<Signature>[];
    }
    & ({
        readonly answer: (invocation: InvocationFor<Signature>) => AnswerReturn<Signature>;
        readonly fallback?: never;
    } | {
        readonly answer?: never;
        readonly fallback?: FallbackFor<Signature>;
    });

type RuntimeBehaviorKind = 'calls' | 'constructs' | 'rejects' | 'resolves' | 'returns' | 'sequence' | 'throws';
type InvocationKind = 'call' | 'construction';
type RuleCriterion = ArgumentRuleCriterion | IndexRuleCriterion;

type ArgumentRuleCriterion = {
    readonly expectedArguments: readonly unknown[];
    readonly kind: 'arguments';
    readonly invocationKind: InvocationKind;
};

type IndexRuleCriterion = {
    readonly index: number;
    readonly kind: 'index';
    readonly invocationKind: InvocationKind;
};

type RuntimeBehavior = {
    readonly answer: unknown;
    readonly kind: Exclude<RuntimeBehaviorKind, 'sequence'>;
} | {
    nextIndex: number;
    readonly entries: readonly SequenceEntry[];
    readonly kind: 'sequence';
};

type RuntimeRule = {
    readonly behavior: RuntimeBehavior;
    readonly criterion: RuleCriterion;
};

type SequenceEntry = RuntimeBehavior | unknown;

type Invocation = {
    readonly arguments: readonly unknown[];
    readonly index: number;
    readonly kind: InvocationKind;
};

type BehaviorAnswer = {
    readonly answered: false;
} | {
    readonly answered: true;
    readonly value: unknown;
};

type RuntimeConfiguration = {
    readonly answer: UnknownFunction<unknown> | null;
    readonly fallback: RuntimeFallback | null;
    readonly rules: readonly RuntimeRule[];
};

type RuntimeFallback = RuntimeBehavior | {
    readonly call?: RuntimeBehavior;
    readonly construction?: RuntimeBehavior;
};

type SupportedModes = ReadonlySet<InvocationKind>;

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

type CallingBehaviorFactory = <Answer extends CallableSignature>(
    answer: Answer
) =>
    & CallBehavior<ReturnType<Answer>, Parameters<Answer>>
    & ConstructionBehavior<ReturnType<Answer>, Parameters<Answer>>;

type SequenceEntries<Entry> = readonly [Entry, Entry, ...Entry[]];
type SequenceResult<Entry> = Entry extends BehaviorType<InvocationKind | 'both', infer Result, readonly unknown[]>
    ? Result
    : Entry;

type SequenceBehaviorFactory = <Entry>(
    entries: SequenceEntries<Entry>
) => Entry extends RuntimeBehavior ? Entry
    : CallBehavior<Entry>;

type CallRuleStarter<ArgumentPattern extends readonly unknown[], MatchKind extends RuleMatchKind> = {
    readonly calls: <Answer extends CallableSignature>(
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

type ConstructionRuleStarter<ArgumentPattern extends readonly unknown[], MatchKind extends RuleMatchKind> = {
    readonly calls: <Answer extends CallableSignature>(
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

type ReturningRuleTerminator<ArgumentPattern extends readonly unknown[], MatchKind extends RuleMatchKind> = {
    (): CallRule<ArgumentPattern, void, MatchKind>;
    <SignatureOrValue>(...value: ReturnArguments<SignatureOrValue>): CallRule<
        ArgumentPattern,
        FixedReturnValue<SignatureOrValue>,
        MatchKind
    >;
};

type ResolvingRuleTerminator<ArgumentPattern extends readonly unknown[], MatchKind extends RuleMatchKind> = <
    SignatureOrValue
>(
    value: ResolvedValue<SignatureOrValue>
) => CallRule<ArgumentPattern, Promise<ResolvedValue<SignatureOrValue>>, MatchKind>;

type RejectingRuleTerminator<ArgumentPattern extends readonly unknown[], MatchKind extends RuleMatchKind> = {
    (reason: unknown): CallRule<ArgumentPattern, Promise<never>, MatchKind>;
    <Signature extends CallableSignature>(
        reason: ReturnType<Signature> extends Promise<unknown> ? unknown : never
    ): CallRule<ArgumentPattern, ReturnType<Signature>, MatchKind>;
};

export type DoubleInvocation<Arguments extends readonly unknown[]> = {
    readonly arguments: Arguments;
    readonly index: number;
    readonly kind: InvocationKind;
};

export type TestDouble<Signature> = Signature;

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

function assertCallableDouble<ReturnValue>(value: unknown): asserts value is UnknownFunction<ReturnValue> {
    if (typeof value !== 'function') {
        throw new TypeError('Expected callable double factory to create a function.');
    }
}

function assertConstructorDouble<Instance>(value: unknown): asserts value is UnknownConstructor<Instance> {
    if (typeof value !== 'function') {
        throw new TypeError('Expected constructor double factory to create a function.');
    }
}

function isConstructorInstance(value: unknown): boolean {
    return typeof value === 'object' && value !== null || typeof value === 'function';
}

function ensureConstructorInstance(instance: unknown, source: string): void {
    if (!isConstructorInstance(instance)) {
        throw new TypeError(`${source} requires an object instance.`);
    }
}

function invocationModeForBehavior(behavior: RuntimeBehavior): InvocationKind | 'both' {
    switch (behavior.kind) {
        case 'calls':
        case 'sequence':
        case 'throws':
            return 'both';
        case 'constructs':
            return 'construction';
        case 'rejects':
        case 'resolves':
        case 'returns':
            return 'call';
    }
}

function behaviorCanAnswer(behavior: RuntimeBehavior, invocation: Invocation): boolean {
    const mode = invocationModeForBehavior(behavior);

    return mode === 'both' || mode === invocation.kind;
}

function returnsBehavior(value: unknown): RuntimeBehavior {
    return { answer: value, kind: 'returns' };
}

function resolvesBehavior(value: unknown): RuntimeBehavior {
    return { answer: value, kind: 'resolves' };
}

function rejectsBehavior(reason: unknown): RuntimeBehavior {
    return { answer: reason, kind: 'rejects' };
}

function throwsBehavior(thrown: unknown): RuntimeBehavior {
    return { answer: thrown, kind: 'throws' };
}

function constructsBehavior(instance: unknown): RuntimeBehavior {
    ensureConstructorInstance(instance, 'rule.constructs()');

    return { answer: instance, kind: 'constructs' };
}

function callsBehavior(answer: unknown): RuntimeBehavior {
    if (typeof answer !== 'function') {
        throw new TypeError('rule.calls() requires a function.');
    }

    return { answer, kind: 'calls' };
}

function sequenceBehavior(entries: readonly unknown[]): RuntimeBehavior {
    return { entries, kind: 'sequence', nextIndex: 0 };
}

function behaviorFromEntry(entry: SequenceEntry): RuntimeBehavior {
    return isRuntimeBehavior(entry) ? entry : returnsBehavior(entry);
}

function answerFromBehavior(behavior: RuntimeBehavior, invocation: Invocation): BehaviorAnswer {
    if (behavior.kind === 'sequence') {
        const entry = behavior.entries[behavior.nextIndex];

        if (entry === undefined) {
            return { answered: false };
        }

        const entryBehavior = behaviorFromEntry(entry);

        if (!behaviorCanAnswer(entryBehavior, invocation)) {
            return { answered: false };
        }

        behavior.nextIndex += 1;

        return answerFromBehavior(entryBehavior, invocation);
    }

    if (!behaviorCanAnswer(behavior, invocation)) {
        return { answered: false };
    }

    switch (behavior.kind) {
        case 'calls':
            return {
                answered: true,
                value: (behavior.answer as UnknownFunction<unknown>)(...invocation.arguments)
            };
        case 'constructs':
        case 'returns':
            return { answered: true, value: behavior.answer };
        case 'rejects':
            return {
                answered: true,
                value: Promise.reject(behavior.answer)
            };
        case 'resolves':
            return {
                answered: true,
                value: Promise.resolve(behavior.answer)
            };
        case 'throws':
            throw behavior.answer;
    }
}

function isRuntimeBehavior(value: unknown): value is RuntimeBehavior {
    return typeof value === 'object' && value !== null && 'kind' in value &&
        typeof (value as { readonly kind: unknown; }).kind === 'string';
}

function argumentsMatch(actualArguments: readonly unknown[], expectedArguments: readonly unknown[]): boolean {
    return actualArguments.length >= expectedArguments.length &&
        expectedArguments.every(function argumentMatches(expectedArgument, index) {
            return comparePartially(actualArguments[index], expectedArgument);
        });
}

function ruleMatches(rule_: RuntimeRule, invocation: Invocation): boolean {
    if (rule_.criterion.invocationKind !== invocation.kind) {
        return false;
    }

    switch (rule_.criterion.kind) {
        case 'arguments':
            return argumentsMatch(invocation.arguments, rule_.criterion.expectedArguments);
        case 'index':
            return rule_.criterion.index === invocation.index;
    }
}

function fallbackForInvocation(fallback: RuntimeFallback, invocation: Invocation): RuntimeBehavior | null {
    if (isRuntimeBehavior(fallback)) {
        return fallback;
    }

    return fallback[invocation.kind] ?? null;
}

function answerFromRules(configuration: RuntimeConfiguration, invocation: Invocation): BehaviorAnswer {
    for (const rule_ of configuration.rules) {
        if (!ruleMatches(rule_, invocation)) {
            continue;
        }

        const answer = answerFromBehavior(rule_.behavior, invocation);

        if (answer.answered) {
            return answer;
        }
    }

    if (configuration.fallback !== null) {
        const fallback = fallbackForInvocation(configuration.fallback, invocation);

        if (fallback !== null) {
            const answer = answerFromBehavior(fallback, invocation);

            if (answer.answered) {
                return answer;
            }
        }
    }

    if (configuration.answer !== null) {
        return {
            answered: true,
            value: configuration.answer(invocation)
        };
    }

    return { answered: false };
}

function createDouble<ReturnValue>(
    configuration: RuntimeConfiguration,
    supportedModes: SupportedModes
): UnknownFunction<ReturnValue> {
    let callIndex = 0;
    let constructionIndex = 0;

    const candidate: unknown = new Proxy(function TestDouble() {
        throw new TypeError('test double target should not be reached.');
    }, {
        apply(_target, _thisArgument, argumentList) {
            if (!supportedModes.has('call')) {
                throw new TypeError('Class constructor TestDouble cannot be invoked without new.');
            }

            const invocation = {
                arguments: Array.from(argumentList),
                index: callIndex,
                kind: 'call' as const
            };
            callIndex += 1;
            const answer = answerFromRules(configuration, invocation);

            if (!answer.answered) {
                throw new TypeError('test double has no configured behavior for this call.');
            }

            return answer.value;
        },
        construct(_target, argumentList) {
            if (!supportedModes.has('construction')) {
                throw new TypeError('test double is not a constructor.');
            }

            const invocation = {
                arguments: Array.from(argumentList),
                index: constructionIndex,
                kind: 'construction' as const
            };
            constructionIndex += 1;
            const answer = answerFromRules(configuration, invocation);

            if (!answer.answered) {
                throw new TypeError('test double has no configured behavior for this construction.');
            }

            if (!isConstructorInstance(answer.value)) {
                throw new TypeError('test double constructor behavior must return an object instance.');
            }

            return answer.value as Record<string, unknown>;
        }
    });

    assertCallableDouble<ReturnValue>(candidate);

    return candidate;
}

function modeSet(...modes: readonly InvocationKind[]): SupportedModes {
    return new Set(modes);
}

function createCallableBehaviorDouble<ReturnValue>(behavior: RuntimeBehavior): UnknownFunction<ReturnValue> {
    return createDouble<ReturnValue>({
        answer: null,
        fallback: behavior,
        rules: []
    }, modeSet('call'));
}

function createConstructorBehaviorDouble<Instance>(behavior: RuntimeBehavior): UnknownConstructor<Instance> {
    const double = createDouble<Instance>({
        answer: null,
        fallback: behavior,
        rules: []
    }, modeSet('construction'));

    assertConstructorDouble<Instance>(double);

    return double;
}

function supportedModesFromBehavior(behavior: RuntimeBehavior, modes: Set<InvocationKind>): void {
    const mode = invocationModeForBehavior(behavior);

    if (mode === 'both') {
        modes.add('call');
        modes.add('construction');
        return;
    }

    modes.add(mode);
}

function supportedModesFromFallback(fallback: RuntimeFallback | null, modes: Set<InvocationKind>): void {
    if (fallback === null) {
        return;
    }

    if (isRuntimeBehavior(fallback)) {
        supportedModesFromBehavior(fallback, modes);
        return;
    }

    if (fallback.call !== undefined) {
        modes.add('call');
    }

    if (fallback.construction !== undefined) {
        modes.add('construction');
    }
}

function supportedModesFromConfiguration(configuration: RuntimeConfiguration): SupportedModes {
    const modes = new Set<InvocationKind>();

    for (const rule_ of configuration.rules) {
        modes.add(rule_.criterion.invocationKind);
    }

    supportedModesFromFallback(configuration.fallback, modes);

    if (configuration.answer !== null) {
        modes.add('call');
        modes.add('construction');
    }

    if (modes.size === 0) {
        modes.add('call');
        modes.add('construction');
    }

    return modes;
}

function isRuntimeConfiguration(value: unknown): value is TestDoubleConfiguration<CallableSignature> {
    return typeof value === 'object' && value !== null;
}

function normalizeRuntimeConfiguration(
    configuration: TestDoubleConfiguration<CallableSignature>
): RuntimeConfiguration {
    return {
        answer: typeof configuration.answer === 'function' ? configuration.answer as UnknownFunction<unknown> : null,
        fallback: configuration.fallback as RuntimeFallback | undefined ?? null,
        rules: configuration.rules as readonly RuntimeRule[] | undefined ?? []
    };
}

function createUntypedDouble(): TestDouble<UnknownFunction<unknown>>;
function createUntypedDouble<Signature extends CallableSignature>(): TestDouble<Signature>;
function createUntypedDouble<Signature extends CallableSignature>(
    configuration: TestDoubleConfiguration<Signature>
): TestDouble<Signature>;
function createUntypedDouble<Signature extends ConstructorSignature>(
    configuration: TestDoubleConfiguration<Signature>
): TestDouble<Signature>;
function createUntypedDouble(...configuration: readonly unknown[]): TestDouble<UnknownFunction<unknown>> {
    if (configuration.length === 0) {
        return createCallableBehaviorDouble(returnsBehavior(undefined));
    }

    if (configuration.length !== 1 || !isRuntimeConfiguration(configuration[0])) {
        throw new TypeError('testDouble() requires a configuration object.');
    }

    const runtimeConfiguration = normalizeRuntimeConfiguration(configuration[0]);

    return createDouble(runtimeConfiguration, supportedModesFromConfiguration(runtimeConfiguration));
}

function createConstructingDouble<SignatureOrInstance>(
    instance: ConstructInstance<SignatureOrInstance>
): TestDouble<ConstructSignature<SignatureOrInstance>>;
function createConstructingDouble(instance: unknown): unknown {
    ensureConstructorInstance(instance, 'testDouble.constructs()');

    return createConstructorBehaviorDouble(constructsBehavior(instance));
}

function createRejectingDouble(reason: unknown): TestDouble<UnknownFunction<Promise<never>>>;
function createRejectingDouble<Signature extends CallableSignature>(
    reason: ReturnType<Signature> extends Promise<unknown> ? unknown : never
): TestDouble<Signature>;
function createRejectingDouble(reason: unknown): UnknownFunction<Promise<never>> {
    return createCallableBehaviorDouble(rejectsBehavior(reason));
}

function createResolvingDouble<SignatureOrValue>(
    value: ResolvedValue<SignatureOrValue>
): TestDouble<ResolvedSignature<SignatureOrValue>>;
function createResolvingDouble(value: unknown): unknown {
    return createCallableBehaviorDouble(resolvesBehavior(value));
}

function createReturningDouble<SignatureOrValue>(
    ...value: ReturnArguments<SignatureOrValue>
): TestDouble<ReturnSignature<SignatureOrValue>>;
function createReturningDouble(...value: readonly unknown[]): UnknownFunction<unknown> {
    return createCallableBehaviorDouble(returnsBehavior(value[0]));
}

function createThrowingDouble(thrown: unknown): TestDouble<UnknownFunction<never>>;
function createThrowingDouble<Signature extends CallableSignature>(
    thrown: ReturnType<Signature> extends Promise<unknown> ? never : unknown
): TestDouble<Signature>;
function createThrowingDouble(thrown: unknown): UnknownFunction<never> {
    return createCallableBehaviorDouble(throwsBehavior(thrown));
}

function createRule(invocationKind: InvocationKind, criterion: RuleCriterion, behavior: RuntimeBehavior): RuntimeRule {
    return { behavior, criterion: { ...criterion, invocationKind } };
}

function createArgumentRuleStarter<ArgumentPattern extends readonly unknown[]>(
    invocationKind: InvocationKind,
    expectedArguments: ArgumentPattern
): CallRuleStarter<ArgumentPattern, 'arguments'> & ConstructionRuleStarter<ArgumentPattern, 'arguments'> {
    const criterion = {
        expectedArguments,
        kind: 'arguments' as const,
        invocationKind
    };

    return createRuleStarter<ArgumentPattern, 'arguments'>(invocationKind, criterion);
}

function createIndexRuleStarter(
    invocationKind: InvocationKind,
    index: number
): CallRuleStarter<readonly unknown[], 'index'> & ConstructionRuleStarter<readonly unknown[], 'index'> {
    if (!Number.isInteger(index) || index < 0) {
        throw new TypeError('ordered double rules require a non-negative integer index.');
    }

    return createRuleStarter<readonly unknown[], 'index'>(invocationKind, {
        index,
        kind: 'index',
        invocationKind
    });
}

function createRuleStarter<ArgumentPattern extends readonly unknown[], MatchKind extends RuleMatchKind>(
    invocationKind: InvocationKind,
    criterion: RuleCriterion
): CallRuleStarter<ArgumentPattern, MatchKind> & ConstructionRuleStarter<ArgumentPattern, MatchKind> {
    const starter = {
        calls(answer: CallableSignature) {
            return createRule(invocationKind, criterion, callsBehavior(answer)) as
                & CallRule<
                    ArgumentPattern,
                    unknown,
                    MatchKind
                >
                & ConstructionRule<ArgumentPattern, unknown, MatchKind>;
        },
        constructs(instance: unknown) {
            return createRule(invocationKind, criterion, constructsBehavior(instance)) as ConstructionRule<
                ArgumentPattern,
                unknown,
                MatchKind
            >;
        },
        rejects(reason: unknown) {
            return createRule(invocationKind, criterion, rejectsBehavior(reason)) as CallRule<
                ArgumentPattern,
                Promise<never>,
                MatchKind
            >;
        },
        resolves(value: unknown) {
            return createRule(invocationKind, criterion, resolvesBehavior(value)) as CallRule<
                ArgumentPattern,
                Promise<unknown>,
                MatchKind
            >;
        },
        returns(...value: readonly unknown[]) {
            return createRule(invocationKind, criterion, returnsBehavior(value[0])) as CallRule<
                ArgumentPattern,
                unknown,
                MatchKind
            >;
        },
        sequence(entries: readonly unknown[]) {
            return createRule(invocationKind, criterion, sequenceBehavior(entries)) as
                & CallRule<
                    ArgumentPattern,
                    unknown,
                    MatchKind
                >
                & ConstructionRule<ArgumentPattern, unknown, MatchKind>;
        },
        throws(thrown: unknown) {
            return createRule(invocationKind, criterion, throwsBehavior(thrown)) as
                & CallRule<
                    ArgumentPattern,
                    never,
                    MatchKind
                >
                & ConstructionRule<ArgumentPattern, never, MatchKind>;
        }
    };

    return starter as unknown as
        & CallRuleStarter<ArgumentPattern, MatchKind>
        & ConstructionRuleStarter<ArgumentPattern, MatchKind>;
}

function whenRule<ExpectedArguments extends readonly [unknown, ...unknown[]]>(
    ...expectedArguments: ExpectedArguments
): CallRuleStarter<ExpectedArguments, 'arguments'> {
    return createArgumentRuleStarter('call', expectedArguments);
}

function whenConstructedWithRule<ExpectedArguments extends readonly [unknown, ...unknown[]]>(
    ...expectedArguments: ExpectedArguments
): ConstructionRuleStarter<ExpectedArguments, 'arguments'> {
    return createArgumentRuleStarter('construction', expectedArguments);
}

export const rule: RuleFactory = {
    calls: callsBehavior as unknown as CallingBehaviorFactory,
    constructs: constructsBehavior as unknown as ConstructingBehaviorFactory,
    onCall(index) {
        return createIndexRuleStarter('call', index);
    },
    onConstruction(index) {
        return createIndexRuleStarter('construction', index);
    },
    rejects: rejectsBehavior as unknown as RejectingBehaviorFactory,
    resolves: resolvesBehavior as unknown as ResolvingBehaviorFactory,
    returns: function createReturningBehavior(...value: readonly unknown[]) {
        return returnsBehavior(value[0]);
    } as unknown as ReturningBehaviorFactory,
    sequence: sequenceBehavior as unknown as SequenceBehaviorFactory,
    throws: throwsBehavior as unknown as ThrowingBehaviorFactory,
    when: whenRule,
    whenConstructedWith: whenConstructedWithRule
};

export const testDouble: TestDoubleFactory = Object.assign(createUntypedDouble, {
    constructs: createConstructingDouble,
    rejects: createRejectingDouble,
    resolves: createResolvingDouble,
    returns: createReturningDouble,
    throws: createThrowingDouble
});

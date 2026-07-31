import {
    answerFromBehavior,
    type BehaviorMode,
    type BehaviorAnswer,
    callsBehavior,
    constructsBehavior,
    ensureConstructorInstance,
    fallbackForInvocation,
    isConstructorInstance,
    isRuntimeBehavior,
    isRuntimeRule,
    isUnknownFunction,
    rejectsBehavior,
    resolvesBehavior,
    returnsBehavior,
    ruleMatches,
    sequenceBehavior,
    throwsBehavior,
    type CallableSignature,
    type ConstructorReturnValue,
    type ConstructorSignature,
    type InvocationKind,
    type RuntimeBehavior,
    type RuntimeConfiguration,
    type RuntimeFallback,
    type RuntimeRule,
    type UnknownConstructor,
    type UnknownFunction
} from './double-behavior.ts';
import type {
    CallBehavior,
    CallRule,
    CallRuleStarter,
    ConstructInstance,
    ConstructSignature,
    ConstructionRule,
    ConstructionRuleStarter,
    ResolvedValue,
    ResolvedSignature,
    ReturnArguments,
    ReturnSignature,
    RuleFactory,
    SequenceResult,
    TestDouble,
    TestDoubleConfiguration,
    TestDoubleFactory
} from './test-double-types.ts';

type ConfigurationRecord = Readonly<Partial<Record<'answer' | 'fallback' | 'rules', unknown>>>;
type InvocationRecord = {
    readonly arguments: readonly unknown[];
    readonly index: number;
    readonly kind: InvocationKind;
};
type SupportedModes = ReadonlySet<InvocationKind>;

function assertCallableDouble<ReturnValue>(value: unknown): asserts value is UnknownFunction<ReturnValue> {
    if (!isUnknownFunction(value)) {
        throw new TypeError('Expected callable double factory to create a function.');
    }
}

function assertConstructorDouble<Instance>(value: unknown): asserts value is UnknownConstructor<Instance> {
    if (!isUnknownFunction(value)) {
        throw new TypeError('Expected constructor double factory to create a function.');
    }
}

function modeSet(...modes: readonly InvocationKind[]): SupportedModes {
    return new Set(modes);
}

function answerFromMatchingRules(rules: readonly RuntimeRule[], invocation: InvocationRecord): BehaviorAnswer {
    for (const configuredRule of rules) {
        const answer = ruleMatches(configuredRule, invocation)
            ? answerFromBehavior(configuredRule.behavior, invocation)
            : { answered: false as const };

        if (answer.answered) {
            return answer;
        }
    }

    return { answered: false as const };
}

function answerFromFallback(fallback: RuntimeFallback | null, invocation: InvocationRecord): BehaviorAnswer {
    if (fallback === null) {
        return { answered: false as const };
    }

    const fallbackBehavior = fallbackForInvocation(fallback, invocation);

    return fallbackBehavior === null ? { answered: false as const } : answerFromBehavior(fallbackBehavior, invocation);
}

function answerFromRules(configuration: RuntimeConfiguration, invocation: InvocationRecord): BehaviorAnswer {
    const ruleAnswer = answerFromMatchingRules(configuration.rules, invocation);

    if (ruleAnswer.answered) {
        return ruleAnswer;
    }

    const fallbackAnswer = answerFromFallback(configuration.fallback, invocation);

    if (fallbackAnswer.answered || configuration.answer === null) {
        return fallbackAnswer;
    }

    return {
        answered: true as const,
        value: configuration.answer(invocation)
    };
}

function answerForInvocation(
    configuration: RuntimeConfiguration,
    invocation: InvocationRecord,
    missingBehaviorMessage: string
): unknown {
    const answer = answerFromRules(configuration, invocation);

    if (!answer.answered) {
        throw new TypeError(missingBehaviorMessage);
    }

    return answer.value;
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

            const invocation: InvocationRecord = {
                arguments: Array.from(argumentList),
                index: callIndex,
                kind: 'call' as const
            };
            callIndex += 1;

            return answerForInvocation(
                configuration,
                invocation,
                'test double has no configured behavior for this call.'
            );
        },
        construct(_target, argumentList): ConstructorReturnValue {
            if (!supportedModes.has('construction')) {
                throw new TypeError('test double is not a constructor.');
            }

            const invocation: InvocationRecord = {
                arguments: Array.from(argumentList),
                index: constructionIndex,
                kind: 'construction' as const
            };
            constructionIndex += 1;
            const answer = answerForInvocation(
                configuration,
                invocation,
                'test double has no configured behavior for this construction.'
            );

            if (!isConstructorInstance(answer)) {
                throw new TypeError('test double constructor behavior must return an object instance.');
            }

            return answer;
        }
    });

    assertCallableDouble<ReturnValue>(candidate);

    return candidate;
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

function modesWithBehavior(behavior: RuntimeBehavior, modes: SupportedModes): SupportedModes {
    const nextModes = new Set(modes);

    if (behavior.mode === 'both') {
        nextModes.add('call');
        nextModes.add('construction');
        return nextModes;
    }

    nextModes.add(behavior.mode);

    return nextModes;
}

function modesWithEntry(
    behavior: RuntimeBehavior | undefined,
    mode: InvocationKind,
    modes: SupportedModes
): SupportedModes {
    if (behavior === undefined) {
        return modes;
    }

    const nextModes = new Set(modes);
    nextModes.add(mode);

    return nextModes;
}

function modesWithFallback(fallback: RuntimeFallback | null, modes: SupportedModes): SupportedModes {
    if (fallback === null) {
        return modes;
    }

    if (isRuntimeBehavior(fallback)) {
        return modesWithBehavior(fallback, modes);
    }

    return modesWithEntry(fallback.construction, 'construction', modesWithEntry(fallback.call, 'call', modes));
}

function modesWithAnswer(answer: UnknownFunction<unknown> | null, modes: SupportedModes): SupportedModes {
    if (answer === null) {
        return modes;
    }

    return modeSet(...modes, 'call', 'construction');
}

function supportedModesFromConfiguration(configuration: RuntimeConfiguration): SupportedModes {
    const ruleModes = new Set(configuration.rules.map(function ruleMode(configuredRule) {
        return configuredRule.criterion.invocationKind;
    }));
    const fallbackModes = modesWithFallback(configuration.fallback, ruleModes);
    const modes = modesWithAnswer(configuration.answer, fallbackModes);

    return modes.size === 0 ? modeSet('call', 'construction') : modes;
}

function isRuntimeConfiguration(value: unknown): value is ConfigurationRecord {
    return typeof value === 'object' && value !== null;
}

function isFallbackRecord(value: unknown): value is RuntimeFallback {
    return typeof value === 'object' && value !== null &&
        (Object.hasOwn(value, 'call') || Object.hasOwn(value, 'construction'));
}

function runtimeFallbackFrom(value: unknown): RuntimeFallback | null {
    if (isRuntimeBehavior(value)) {
        return value;
    }

    return isFallbackRecord(value) ? value : null;
}

function normalizeRuntimeConfiguration(configuration: ConfigurationRecord): RuntimeConfiguration {
    return {
        answer: isUnknownFunction(configuration.answer) ? configuration.answer : null,
        fallback: runtimeFallbackFrom(configuration.fallback),
        rules: Array.isArray(configuration.rules) ? configuration.rules.filter(isRuntimeRule) : []
    };
}

function createUntypedDouble(): TestDouble<UnknownFunction<unknown>>;
function createUntypedDouble<Signature extends CallableSignature>(): TestDouble<Signature>;
function createUntypedDouble<Signature extends CallableSignature | ConstructorSignature>(
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

export const testDouble: TestDoubleFactory = Object.assign(createUntypedDouble, {
    constructs: createConstructingDouble,
    rejects: createRejectingDouble,
    resolves: createResolvingDouble,
    returns: createReturningDouble,
    throws: createThrowingDouble
});

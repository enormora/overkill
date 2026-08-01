import {
    type CallableSignature,
    type ConstructorSignature,
    constructsBehavior,
    type DoubleInvocation,
    ensureConstructorInstance,
    type InvocationKind,
    isRuntimeBehavior,
    isRuntimeRule,
    isUnknownFunction,
    rejectsBehavior,
    resolvesBehavior,
    type RuntimeBehavior,
    type RuntimeConfiguration,
    type RuntimeFallback,
    returnsBehavior,
    throwsBehavior,
    type UnknownConstructor,
    type UnknownFunction
} from './double-behavior.ts';
import type { DoubleHistory as HistoryForDouble } from './double-history.ts';
import type {
    CallArguments,
    CallReturn,
    ConstructInstance,
    ConstructSignature,
    ConstructionArguments,
    ConstructionInstance,
    DoubleRuleFor,
    FallbackFor,
    ResolvedSignature,
    ResolvedValue,
    ReturnArguments,
    ReturnSignature
} from './double-rule.ts';
import { createDouble, modeSet, type SupportedModes } from './double-runtime.ts';

type ConfigurationRecord = Readonly<Partial<Record<'answer' | 'fallback' | 'rules', unknown>>>;
type CallableInvocationFor<Signature> = [Signature] extends [CallableSignature]
    ? DoubleInvocation<CallArguments<Signature>>
    : never;

type ConstructionInvocationFor<Signature> = [Signature] extends [ConstructorSignature]
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

type TestDoubleConfiguration<Signature> = AnswerConfiguration<Signature> | FallbackConfiguration<Signature>;

export type DoubleHistory<Signature> = HistoryForDouble<Signature>;

export type TestDouble<Signature> = DoubleHistory<Signature> & Signature;

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

function createCallableBehaviorDouble<ReturnValue>(
    behavior: RuntimeBehavior
): TestDouble<UnknownFunction<ReturnValue>> {
    return createDouble<UnknownFunction<ReturnValue>>({
        answer: null,
        fallback: behavior,
        rules: []
    }, modeSet('call'));
}

function createConstructorBehaviorDouble<Instance>(
    behavior: RuntimeBehavior
): TestDouble<UnknownConstructor<Instance>> {
    const double = createDouble<UnknownConstructor<Instance>>({
        answer: null,
        fallback: behavior,
        rules: []
    }, modeSet('construction'));

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
function createRejectingDouble(reason: unknown): TestDouble<UnknownFunction<Promise<never>>> {
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
function createReturningDouble(...value: readonly unknown[]): TestDouble<UnknownFunction<unknown>> {
    return createCallableBehaviorDouble(returnsBehavior(value[0]));
}

function createThrowingDouble(thrown: unknown): TestDouble<UnknownFunction<never>>;
function createThrowingDouble<Signature extends CallableSignature>(
    thrown: ReturnType<Signature> extends Promise<unknown> ? never : unknown
): TestDouble<Signature>;
function createThrowingDouble(thrown: unknown): TestDouble<UnknownFunction<never>> {
    return createCallableBehaviorDouble(throwsBehavior(thrown));
}

export const testDouble: TestDoubleFactory = Object.assign(createUntypedDouble, {
    constructs: createConstructingDouble,
    rejects: createRejectingDouble,
    resolves: createResolvingDouble,
    returns: createReturningDouble,
    throws: createThrowingDouble
});

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
    yieldsAsyncBehavior,
    yieldsAsyncFromBehavior,
    yieldsBehavior,
    yieldsFromBehavior,
    type UnknownConstructor,
    type UnknownFunction
} from './double-behavior.ts';
import type { DoubleHistory as HistoryForDouble } from './double-history.ts';
import type {
    AsyncGeneratorSignature,
    AsyncReturnArguments,
    AsyncSourceFactory,
    AsyncYieldValue,
    SyncGeneratorSignature,
    SyncReturnArguments,
    SyncSourceFactory,
    SyncYieldValue
} from './double-rule-generator.ts';
import type {
    ConstructInstance,
    ConstructSignature,
    DoubleRuleFor,
    FallbackFor,
    ResolvedSignature,
    ResolvedValue,
    ReturnArguments,
    ReturnSignature
} from './double-rule-types.ts';
import type {
    CallArguments,
    CallReturn,
    ConstructionArguments,
    ConstructionInstance
} from './double-signature.ts';
import { createChronologyScope, type ChronologyScope } from './double-chronology.ts';
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

export type TestDoubleConfiguration<Signature> = AnswerConfiguration<Signature> | FallbackConfiguration<Signature>;

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
    readonly yields: {
        <YieldValue>(
            values: readonly YieldValue[]
        ): TestDouble<UnknownFunction<Generator<YieldValue, undefined, unknown>>>;
        <YieldValue, ReturnValue>(
            values: readonly YieldValue[],
            returnValue: ReturnValue
        ): TestDouble<UnknownFunction<Generator<YieldValue, ReturnValue, unknown>>>;
        <Signature extends CallableSignature>(
            values: readonly SyncYieldValue<ReturnType<SyncGeneratorSignature<Signature>>>[],
            ...returnValue: SyncReturnArguments<ReturnType<SyncGeneratorSignature<Signature>>>
        ): TestDouble<SyncGeneratorSignature<Signature>>;
    };
    readonly yieldsAsync: {
        <YieldValue>(
            values: readonly YieldValue[]
        ): TestDouble<UnknownFunction<AsyncGenerator<YieldValue, undefined, unknown>>>;
        <YieldValue, ReturnValue>(
            values: readonly YieldValue[],
            returnValue: ReturnValue
        ): TestDouble<UnknownFunction<AsyncGenerator<YieldValue, ReturnValue, unknown>>>;
        <Signature extends CallableSignature>(
            values: readonly AsyncYieldValue<ReturnType<AsyncGeneratorSignature<Signature>>>[],
            ...returnValue: AsyncReturnArguments<ReturnType<AsyncGeneratorSignature<Signature>>>
        ): TestDouble<AsyncGeneratorSignature<Signature>>;
    };
    readonly yieldsAsyncFrom: {
        <SourceFactory extends (...arguments_: readonly unknown[]) => AsyncIterable<unknown> | Iterable<unknown>>(
            sourceFactory: SourceFactory
        ): TestDouble<UnknownFunction<ReturnType<SourceFactory>>>;
        <Signature extends CallableSignature>(
            sourceFactory: AsyncSourceFactory<Signature>
        ): TestDouble<AsyncGeneratorSignature<Signature>>;
    };
    readonly yieldsFrom: {
        <SourceFactory extends (...arguments_: readonly unknown[]) => Iterable<unknown>>(
            sourceFactory: SourceFactory
        ): TestDouble<UnknownFunction<ReturnType<SourceFactory>>>;
        <Signature extends CallableSignature>(
            sourceFactory: SyncSourceFactory<Signature>
        ): TestDouble<SyncGeneratorSignature<Signature>>;
    };
};

export type TestDoubleScope = {
    readonly testDouble: TestDoubleFactory;
};

function createCallableBehaviorDouble<ReturnValue>(
    scope: TestDoubleScopeContext,
    behavior: RuntimeBehavior
): TestDouble<UnknownFunction<ReturnValue>> {
    return createDouble<UnknownFunction<ReturnValue>>(
        {
            answer: null,
            fallback: behavior,
            rules: []
        },
        scope.chronology,
        modeSet('call')
    );
}

function createConstructorBehaviorDouble<Instance>(
    scope: TestDoubleScopeContext,
    behavior: RuntimeBehavior
): TestDouble<UnknownConstructor<Instance>> {
    const double = createDouble<UnknownConstructor<Instance>>(
        {
            answer: null,
            fallback: behavior,
            rules: []
        },
        scope.chronology,
        modeSet('construction')
    );

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

type TestDoubleScopeContext = {
    readonly chronology: ChronologyScope;
};

type TestDoubleCreator = <Signature extends CallableSignature | ConstructorSignature = UnknownFunction<unknown>>(
    ...configuration: Signature extends ConstructorSignature ? readonly [TestDoubleConfiguration<Signature>]
        : readonly [] | readonly [TestDoubleConfiguration<Signature>]
) => TestDouble<Signature>;

function createUntypedDoubleFromUnknowns(
    scope: TestDoubleScopeContext,
    configuration: readonly unknown[]
): TestDouble<UnknownFunction<unknown>> {
    if (configuration.length === 0) {
        return createCallableBehaviorDouble(scope, returnsBehavior(undefined));
    }

    if (configuration.length !== 1 || !isRuntimeConfiguration(configuration[0])) {
        throw new TypeError('testDouble() requires a configuration object.');
    }

    const runtimeConfiguration = normalizeRuntimeConfiguration(configuration[0]);

    return createDouble(runtimeConfiguration, scope.chronology, supportedModesFromConfiguration(runtimeConfiguration));
}

function createConstructingDouble<SignatureOrInstance>(
    scope: TestDoubleScopeContext,
    instance: ConstructInstance<SignatureOrInstance>
): TestDouble<ConstructSignature<SignatureOrInstance>>;
function createConstructingDouble(scope: TestDoubleScopeContext, instance: unknown): unknown {
    ensureConstructorInstance(instance, 'testDouble.constructs()');

    return createConstructorBehaviorDouble(scope, constructsBehavior(instance));
}

function createRejectingDouble(
    scope: TestDoubleScopeContext,
    reason: unknown
): TestDouble<UnknownFunction<Promise<never>>>;
function createRejectingDouble<Signature extends CallableSignature>(
    scope: TestDoubleScopeContext,
    reason: ReturnType<Signature> extends Promise<unknown> ? unknown : never
): TestDouble<Signature>;
function createRejectingDouble(
    scope: TestDoubleScopeContext,
    reason: unknown
): TestDouble<UnknownFunction<Promise<never>>> {
    return createCallableBehaviorDouble(scope, rejectsBehavior(reason));
}

function createResolvingDouble<SignatureOrValue>(
    scope: TestDoubleScopeContext,
    value: ResolvedValue<SignatureOrValue>
): TestDouble<ResolvedSignature<SignatureOrValue>>;
function createResolvingDouble(scope: TestDoubleScopeContext, value: unknown): unknown {
    return createCallableBehaviorDouble(scope, resolvesBehavior(value));
}

function createThrowingDouble(
    scope: TestDoubleScopeContext,
    thrown: unknown
): TestDouble<UnknownFunction<never>>;
function createThrowingDouble<Signature extends CallableSignature>(
    scope: TestDoubleScopeContext,
    thrown: ReturnType<Signature> extends Promise<unknown> ? never : unknown
): TestDouble<Signature>;
function createThrowingDouble(
    scope: TestDoubleScopeContext,
    thrown: unknown
): TestDouble<UnknownFunction<never>> {
    return createCallableBehaviorDouble(scope, throwsBehavior(thrown));
}

function createYieldingDouble(
    scope: TestDoubleScopeContext,
    values: readonly unknown[],
    ...returnValue: readonly [] | readonly [unknown]
): TestDouble<UnknownFunction<Generator<unknown, unknown, unknown>>> {
    return createCallableBehaviorDouble(scope, yieldsBehavior(values, returnValue[0]));
}

function createYieldingFromDouble(
    scope: TestDoubleScopeContext,
    sourceFactory: (...arguments_: readonly unknown[]) => Iterable<unknown>
): TestDouble<UnknownFunction<Iterable<unknown>>> {
    return createCallableBehaviorDouble(scope, yieldsFromBehavior(sourceFactory));
}

function createAsyncYieldingDouble(
    scope: TestDoubleScopeContext,
    values: readonly unknown[],
    ...returnValue: readonly [] | readonly [unknown]
): TestDouble<UnknownFunction<AsyncGenerator<unknown, unknown, unknown>>> {
    return createCallableBehaviorDouble(scope, yieldsAsyncBehavior(values, returnValue[0]));
}

function createAsyncYieldingFromDouble(
    scope: TestDoubleScopeContext,
    sourceFactory: (...arguments_: readonly unknown[]) => AsyncIterable<unknown> | Iterable<unknown>
): TestDouble<UnknownFunction<AsyncIterable<unknown> | Iterable<unknown>>> {
    return createCallableBehaviorDouble(scope, yieldsAsyncFromBehavior(sourceFactory));
}

function createScopedDoubleFunction(scope: TestDoubleScopeContext): TestDoubleCreator {
    function scopedDouble<Signature extends CallableSignature | ConstructorSignature = UnknownFunction<unknown>>(
        ...configuration: Signature extends ConstructorSignature ? readonly [TestDoubleConfiguration<Signature>]
            : readonly [] | readonly [TestDoubleConfiguration<Signature>]
    ): TestDouble<Signature>;
    function scopedDouble(...configuration: readonly unknown[]): TestDouble<UnknownFunction<unknown>> {
        return createUntypedDoubleFromUnknowns(scope, configuration);
    }

    return scopedDouble;
}

function createScopedConstructs(scope: TestDoubleScopeContext): TestDoubleFactory['constructs'] {
    function scopedConstructs<SignatureOrInstance>(
        instance: ConstructInstance<SignatureOrInstance>
    ): TestDouble<ConstructSignature<SignatureOrInstance>>;
    function scopedConstructs(instance: unknown): unknown {
        return createConstructingDouble(scope, instance);
    }

    return scopedConstructs;
}

function createScopedRejects(scope: TestDoubleScopeContext): TestDoubleFactory['rejects'] {
    function scopedRejects(reason: unknown): TestDouble<UnknownFunction<Promise<never>>>;
    function scopedRejects<Signature extends CallableSignature>(
        reason: ReturnType<Signature> extends Promise<unknown> ? unknown : never
    ): TestDouble<Signature>;
    function scopedRejects(reason: unknown): TestDouble<UnknownFunction<Promise<never>>> {
        return createRejectingDouble(scope, reason);
    }

    return scopedRejects;
}

function createScopedResolves(scope: TestDoubleScopeContext): TestDoubleFactory['resolves'] {
    function scopedResolves<SignatureOrValue>(
        value: ResolvedValue<SignatureOrValue>
    ): TestDouble<ResolvedSignature<SignatureOrValue>>;
    function scopedResolves(value: unknown): unknown {
        return createResolvingDouble(scope, value);
    }

    return scopedResolves;
}

function createScopedReturns(scope: TestDoubleScopeContext): TestDoubleFactory['returns'] {
    function scopedReturns<SignatureOrValue>(
        ...value: ReturnArguments<SignatureOrValue>
    ): TestDouble<ReturnSignature<SignatureOrValue>>;
    function scopedReturns(...value: readonly unknown[]): TestDouble<UnknownFunction<unknown>> {
        return createCallableBehaviorDouble(scope, returnsBehavior(value[0]));
    }

    return scopedReturns;
}

function createScopedThrows(scope: TestDoubleScopeContext): TestDoubleFactory['throws'] {
    function scopedThrows(thrown: unknown): TestDouble<UnknownFunction<never>>;
    function scopedThrows<Signature extends CallableSignature>(
        thrown: ReturnType<Signature> extends Promise<unknown> ? never : unknown
    ): TestDouble<Signature>;
    function scopedThrows(thrown: unknown): TestDouble<UnknownFunction<never>> {
        return createThrowingDouble(scope, thrown);
    }

    return scopedThrows;
}

function createScopedYields(scope: TestDoubleScopeContext): TestDoubleFactory['yields'] {
    function scopedYields<YieldValue>(
        values: readonly YieldValue[]
    ): TestDouble<UnknownFunction<Generator<YieldValue, undefined, unknown>>>;
    function scopedYields<YieldValue, ReturnValue>(
        values: readonly YieldValue[],
        returnValue: ReturnValue
    ): TestDouble<UnknownFunction<Generator<YieldValue, ReturnValue, unknown>>>;
    function scopedYields<Signature extends CallableSignature>(
        values: readonly SyncYieldValue<ReturnType<SyncGeneratorSignature<Signature>>>[],
        ...returnValue: SyncReturnArguments<ReturnType<SyncGeneratorSignature<Signature>>>
    ): TestDouble<SyncGeneratorSignature<Signature>>;
    function scopedYields(
        values: readonly unknown[],
        ...returnValue: readonly [] | readonly [unknown]
    ): TestDouble<UnknownFunction<Generator<unknown, unknown, unknown>>> {
        return createYieldingDouble(scope, values, ...returnValue);
    }

    return scopedYields;
}

function createScopedYieldsFrom(scope: TestDoubleScopeContext): TestDoubleFactory['yieldsFrom'] {
    function scopedYieldsFrom<SourceFactory extends (...arguments_: readonly unknown[]) => Iterable<unknown>>(
        sourceFactory: SourceFactory
    ): TestDouble<UnknownFunction<ReturnType<SourceFactory>>>;
    function scopedYieldsFrom<Signature extends CallableSignature>(
        sourceFactory: SyncSourceFactory<Signature>
    ): TestDouble<SyncGeneratorSignature<Signature>>;
    function scopedYieldsFrom(
        sourceFactory: (...arguments_: readonly unknown[]) => Iterable<unknown>
    ): TestDouble<UnknownFunction<Iterable<unknown>>> {
        return createYieldingFromDouble(scope, sourceFactory);
    }

    return scopedYieldsFrom;
}

function createScopedYieldsAsync(scope: TestDoubleScopeContext): TestDoubleFactory['yieldsAsync'] {
    function scopedYieldsAsync<YieldValue>(
        values: readonly YieldValue[]
    ): TestDouble<UnknownFunction<AsyncGenerator<YieldValue, undefined, unknown>>>;
    function scopedYieldsAsync<YieldValue, ReturnValue>(
        values: readonly YieldValue[],
        returnValue: ReturnValue
    ): TestDouble<UnknownFunction<AsyncGenerator<YieldValue, ReturnValue, unknown>>>;
    function scopedYieldsAsync<Signature extends CallableSignature>(
        values: readonly AsyncYieldValue<ReturnType<AsyncGeneratorSignature<Signature>>>[],
        ...returnValue: AsyncReturnArguments<ReturnType<AsyncGeneratorSignature<Signature>>>
    ): TestDouble<AsyncGeneratorSignature<Signature>>;
    function scopedYieldsAsync(
        values: readonly unknown[],
        ...returnValue: readonly [] | readonly [unknown]
    ): TestDouble<UnknownFunction<AsyncGenerator<unknown, unknown, unknown>>> {
        return createAsyncYieldingDouble(scope, values, ...returnValue);
    }

    return scopedYieldsAsync;
}

function createScopedYieldsAsyncFrom(scope: TestDoubleScopeContext): TestDoubleFactory['yieldsAsyncFrom'] {
    function scopedYieldsAsyncFrom<
        SourceFactory extends (...arguments_: readonly unknown[]) => AsyncIterable<unknown> | Iterable<unknown>
    >(sourceFactory: SourceFactory): TestDouble<UnknownFunction<ReturnType<SourceFactory>>>;
    function scopedYieldsAsyncFrom<Signature extends CallableSignature>(
        sourceFactory: AsyncSourceFactory<Signature>
    ): TestDouble<AsyncGeneratorSignature<Signature>>;
    function scopedYieldsAsyncFrom(
        sourceFactory: (...arguments_: readonly unknown[]) => AsyncIterable<unknown> | Iterable<unknown>
    ): TestDouble<UnknownFunction<AsyncIterable<unknown> | Iterable<unknown>>> {
        return createAsyncYieldingFromDouble(scope, sourceFactory);
    }

    return scopedYieldsAsyncFrom;
}

export function createTestDoubleScope(): TestDoubleScope {
    const scope = { chronology: createChronologyScope() };

    return {
        testDouble: Object.assign(createScopedDoubleFunction(scope), {
            constructs: createScopedConstructs(scope),
            rejects: createScopedRejects(scope),
            resolves: createScopedResolves(scope),
            returns: createScopedReturns(scope),
            throws: createScopedThrows(scope),
            yields: createScopedYields(scope),
            yieldsAsync: createScopedYieldsAsync(scope),
            yieldsAsyncFrom: createScopedYieldsAsyncFrom(scope),
            yieldsFrom: createScopedYieldsFrom(scope)
        })
    };
}

export const testDouble: TestDoubleFactory = createTestDoubleScope().testDouble;

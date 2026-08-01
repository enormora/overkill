import { comparePartially } from '../compare/raw-comparison.ts';

export type CallableSignature = (...arguments_: readonly never[]) => unknown;
export type ConstructorSignature = new (...arguments_: readonly never[]) => unknown;
export type UnknownFunction<Result> = (...arguments_: readonly unknown[]) => Result;
export type UnknownConstructor<Instance> = new (...arguments_: readonly unknown[]) => Instance;

export type InvocationKind = 'call' | 'construction';
export type BehaviorMode = InvocationKind | 'both';
type RuleMatchKind = 'arguments' | 'index';

export type DoubleInvocation<Arguments extends readonly unknown[]> = {
    readonly arguments: Arguments;
    readonly index: number;
    readonly kind: InvocationKind;
};

export type Invocation<Arguments extends readonly unknown[] = readonly unknown[]> = DoubleInvocation<Arguments>;
type CallInvocation = DoubleInvocation<readonly unknown[]> & {
    readonly kind: 'call';
};

export type BehaviorAnswer = {
    readonly answered: false;
} | {
    readonly answered: true;
    readonly value: unknown;
};

type FixedBehaviorKindByName = {
    readonly calls: 'calls';
    readonly constructs: 'constructs';
    readonly rejects: 'rejects';
    readonly resolves: 'resolves';
    readonly returns: 'returns';
    readonly throws: 'throws';
    readonly yields: 'yields';
    readonly yieldsAsync: 'yields-async';
    readonly yieldsAsyncFrom: 'yields-async-from';
    readonly yieldsFrom: 'yields-from';
};

type FixedBehaviorKindValue = FixedBehaviorKindByName[keyof FixedBehaviorKindByName];

type FixedBehavior<Mode extends BehaviorMode, Result> = {
    readonly behaviorKind: FixedBehaviorKindValue;
    readonly mode: Mode;
    produce: (invocation: Invocation, runtime: BehaviorRuntime) => unknown;
    result: () => Result;
};

type SequenceBehavior<Mode extends BehaviorMode, Result> = {
    readonly behaviorKind: 'sequence';
    readonly entries: readonly unknown[];
    readonly mode: Mode;
    result: () => Result;
};

type RuntimeBehaviorVariants<Mode extends BehaviorMode, Result> = {
    readonly fixed: FixedBehavior<Mode, Result>;
    readonly sequence: SequenceBehavior<Mode, Result>;
};

export type RuntimeBehavior<Mode extends BehaviorMode = BehaviorMode, Result = unknown> = RuntimeBehaviorVariants<
    Mode,
    Result
>[keyof RuntimeBehaviorVariants<Mode, Result>];

type ArgumentCriterion<Kind extends InvocationKind, ArgumentPattern extends readonly unknown[]> = {
    readonly expectedArguments: ArgumentPattern;
    readonly invocationKind: Kind;
    readonly kind: 'arguments';
};

type IndexCriterion<Kind extends InvocationKind> = {
    readonly index: number;
    readonly invocationKind: Kind;
    readonly kind: 'index';
};

type RuleCriterion<
    Kind extends InvocationKind,
    ArgumentPattern extends readonly unknown[],
    MatchKind extends RuleMatchKind
> = MatchKind extends 'arguments' ? ArgumentCriterion<Kind, ArgumentPattern> : IndexCriterion<Kind>;

export type RuntimeRule<
    Kind extends InvocationKind = InvocationKind,
    ArgumentPattern extends readonly unknown[] = readonly unknown[],
    Result = unknown,
    MatchKind extends RuleMatchKind = RuleMatchKind
> = {
    readonly behavior: RuntimeBehavior<BehaviorMode, Result>;
    readonly criterion: RuleCriterion<Kind, ArgumentPattern, MatchKind>;
};

export type RuntimeFallback = RuntimeBehavior | {
    readonly call?: RuntimeBehavior;
    readonly construction?: RuntimeBehavior;
};

export type RuntimeConfiguration = {
    readonly answer: UnknownFunction<unknown> | null;
    readonly fallback: RuntimeFallback | null;
    readonly rules: readonly RuntimeRule[];
};

export type ConstructorReturnValue = CallableSignature | Readonly<Record<PropertyKey, unknown>>;

export type BehaviorRuntime = {
    readonly nextSequenceEntry: (behavior: RuntimeBehavior) => unknown;
    readonly trackAsyncIterator: (
        invocation: CallInvocation,
        source: () => AsyncIterator<unknown, unknown, unknown> | Iterator<unknown, unknown, unknown>
    ) => AsyncIterableIterator<unknown>;
    readonly trackSyncIterator: (
        invocation: CallInvocation,
        source: () => Iterator<unknown, unknown, unknown>
    ) => IterableIterator<unknown>;
};

const unanswered: BehaviorAnswer = { answered: false };

export function isUnknownFunction(value: unknown): value is UnknownFunction<unknown> {
    return typeof value === 'function';
}

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    return typeof value === 'object' && value !== null;
}

export function isConstructorInstance(value: unknown): value is ConstructorReturnValue {
    return isRecord(value) || typeof value === 'function';
}

export function ensureConstructorInstance(instance: unknown, source: string): void {
    if (!isConstructorInstance(instance)) {
        throw new TypeError(`${source} requires an object instance.`);
    }
}

export function returnsBehavior<Value>(value: Value): RuntimeBehavior<'call', Value> {
    return {
        behaviorKind: 'returns',
        mode: 'call',
        result() {
            return value;
        },
        produce() {
            return value;
        }
    };
}

export function resolvesBehavior<Value>(value: Value): RuntimeBehavior<'call', Promise<Value>> {
    return {
        behaviorKind: 'resolves',
        mode: 'call',
        async result() {
            return value;
        },
        async produce() {
            return value;
        }
    };
}

export function rejectsBehavior(reason: unknown): RuntimeBehavior<'call', Promise<never>> {
    return {
        behaviorKind: 'rejects',
        mode: 'call',
        async result() {
            throw reason;
        },
        async produce() {
            throw reason;
        }
    };
}

export function throwsBehavior(thrown: unknown): RuntimeBehavior<'both', never> {
    return {
        behaviorKind: 'throws',
        mode: 'both',
        result() {
            throw thrown;
        },
        produce() {
            throw thrown;
        }
    };
}

export function constructsBehavior<Instance>(instance: Instance): RuntimeBehavior<'construction', Instance> {
    ensureConstructorInstance(instance, 'rule.constructs()');

    return {
        behaviorKind: 'constructs',
        mode: 'construction',
        result() {
            return instance;
        },
        produce() {
            return instance;
        }
    };
}

export function callsBehavior<Answer extends UnknownFunction<unknown>>(
    answer: Answer
): RuntimeBehavior<'both', ReturnType<Answer>> {
    return {
        behaviorKind: 'calls',
        mode: 'both',
        result() {
            throw new TypeError('calls result marker should not be called.');
        },
        produce(invocation) {
            return answer(...invocation.arguments);
        }
    };
}

function ensureCallInvocation(invocation: Invocation): asserts invocation is CallInvocation {
    if (invocation.kind !== 'call') {
        throw new TypeError('generator behavior can only answer calls.');
    }
}

function syncValuesIterator<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue: ReturnValue
): Generator<YieldValue, ReturnValue, unknown> {
    return (function* yieldValues() {
        yield* values;
        return returnValue;
    })();
}

function syncDelegatedIterator(
    sourceFactory: (...arguments_: readonly unknown[]) => Iterable<unknown>,
    invocationArguments: readonly unknown[]
): Iterator<unknown, unknown, unknown> {
    return (function* yieldDelegatedValues() {
        const returnValue: unknown = yield* sourceFactory(...invocationArguments);

        return returnValue;
    })();
}

function asyncValuesIterator<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue: ReturnValue
): AsyncGenerator<YieldValue, ReturnValue, unknown> {
    return (async function* yieldAsyncValues() {
        yield* values;
        return returnValue;
    })();
}

function asyncDelegatedIterator(
    sourceFactory: (...arguments_: readonly unknown[]) => AsyncIterable<unknown> | Iterable<unknown>,
    invocationArguments: readonly unknown[]
): AsyncGenerator<unknown, unknown, unknown> {
    return (async function* yieldAsyncDelegatedValues() {
        const returnValue: unknown = yield* sourceFactory(...invocationArguments);

        return returnValue;
    })();
}

export function yieldsBehavior<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue: ReturnValue
): RuntimeBehavior<'call', Generator<YieldValue, ReturnValue, unknown>> {
    const snapshot = Array.from(values);

    return {
        behaviorKind: 'yields',
        mode: 'call',
        result() {
            return syncValuesIterator(snapshot, returnValue);
        },
        produce(invocation, runtime) {
            ensureCallInvocation(invocation);

            return runtime.trackSyncIterator(
                invocation,
                function createIterator() {
                    return syncValuesIterator(snapshot, returnValue);
                }
            );
        }
    };
}

export function yieldsFromBehavior<SourceFactory extends (...arguments_: readonly unknown[]) => Iterable<unknown>>(
    sourceFactory: SourceFactory
): RuntimeBehavior<'call', ReturnType<SourceFactory>> {
    return {
        behaviorKind: 'yields-from',
        mode: 'call',
        result() {
            throw new TypeError('yieldsFrom result marker should not be called.');
        },
        produce(invocation, runtime) {
            ensureCallInvocation(invocation);

            const invocationArguments = Array.from(invocation.arguments);

            return runtime.trackSyncIterator(
                invocation,
                function createIterator() {
                    return syncDelegatedIterator(sourceFactory, invocationArguments);
                }
            );
        }
    };
}

export function yieldsAsyncBehavior<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue: ReturnValue
): RuntimeBehavior<'call', AsyncGenerator<YieldValue, ReturnValue, unknown>> {
    const snapshot = Array.from(values);

    return {
        behaviorKind: 'yields-async',
        mode: 'call',
        result() {
            return asyncValuesIterator(snapshot, returnValue);
        },
        produce(invocation, runtime) {
            ensureCallInvocation(invocation);

            return runtime.trackAsyncIterator(
                invocation,
                function createIterator() {
                    return asyncValuesIterator(snapshot, returnValue);
                }
            );
        }
    };
}

export function yieldsAsyncFromBehavior<
    SourceFactory extends (...arguments_: readonly unknown[]) => AsyncIterable<unknown> | Iterable<unknown>
>(sourceFactory: SourceFactory): RuntimeBehavior<'call', ReturnType<SourceFactory>> {
    return {
        behaviorKind: 'yields-async-from',
        mode: 'call',
        result() {
            throw new TypeError('yieldsAsyncFrom result marker should not be called.');
        },
        produce(invocation, runtime) {
            ensureCallInvocation(invocation);

            const invocationArguments = Array.from(invocation.arguments);

            return runtime.trackAsyncIterator(
                invocation,
                function createIterator() {
                    return asyncDelegatedIterator(sourceFactory, invocationArguments);
                }
            );
        }
    };
}

export function sequenceBehavior<Result = unknown>(
    entries: readonly [unknown, unknown, ...unknown[]]
): RuntimeBehavior<'both', Result> {
    return {
        behaviorKind: 'sequence',
        entries,
        mode: 'both',
        result() {
            throw new TypeError('sequence result marker should not be called.');
        }
    };
}

export function isRuntimeBehavior(value: unknown): value is RuntimeBehavior {
    return isRecord(value) &&
        Object.hasOwn(value, 'behaviorKind') &&
        Object.hasOwn(value, 'mode');
}

export function isRuntimeRule(value: unknown): value is RuntimeRule {
    return isRecord(value) &&
        Object.hasOwn(value, 'behavior') &&
        Object.hasOwn(value, 'criterion');
}

function behaviorCanAnswer(behavior: RuntimeBehavior, invocation: Invocation): boolean {
    return behavior.mode === 'both' || behavior.mode === invocation.kind;
}

function behaviorFromEntry(entry: unknown): RuntimeBehavior {
    return isRuntimeBehavior(entry) ? entry : returnsBehavior(entry);
}

function fixedBehaviorFrom(
    behavior: RuntimeBehavior,
    invocation: Invocation,
    runtime: BehaviorRuntime
): RuntimeBehavior | null {
    let currentBehavior = behavior;

    while (currentBehavior.behaviorKind === 'sequence') {
        const entry = runtime.nextSequenceEntry(currentBehavior);

        if (entry === undefined) {
            return null;
        }

        currentBehavior = behaviorFromEntry(entry);

        if (!behaviorCanAnswer(currentBehavior, invocation)) {
            return null;
        }
    }

    return currentBehavior;
}

export function answerFromBehavior(
    behavior: RuntimeBehavior,
    invocation: Invocation,
    runtime: BehaviorRuntime
): BehaviorAnswer {
    if (!behaviorCanAnswer(behavior, invocation)) {
        return unanswered;
    }

    const fixedBehavior = fixedBehaviorFrom(behavior, invocation, runtime);

    return fixedBehavior === null
        ? unanswered
        : {
            answered: true,
            value: fixedBehavior.behaviorKind === 'sequence'
                ? fixedBehavior.result()
                : fixedBehavior.produce(invocation, runtime)
        };
}

function argumentsMatch(actualArguments: readonly unknown[], expectedArguments: readonly unknown[]): boolean {
    return actualArguments.length >= expectedArguments.length &&
        expectedArguments.every(function argumentMatches(expectedArgument, index) {
            return comparePartially(actualArguments[index], expectedArgument);
        });
}

export function ruleMatches(configuredRule: RuntimeRule, invocation: Invocation): boolean {
    if (configuredRule.criterion.invocationKind !== invocation.kind) {
        return false;
    }

    return configuredRule.criterion.kind === 'arguments'
        ? argumentsMatch(invocation.arguments, configuredRule.criterion.expectedArguments)
        : configuredRule.criterion.index === invocation.index;
}

export function fallbackForInvocation(fallback: RuntimeFallback, invocation: Invocation): RuntimeBehavior | null {
    if (isRuntimeBehavior(fallback)) {
        return fallback;
    }

    return fallback[invocation.kind] ?? null;
}

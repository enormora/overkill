import {
    answerFromBehavior,
    type BehaviorAnswer,
    type BehaviorRuntime,
    fallbackForInvocation,
    isConstructorInstance,
    isUnknownFunction,
    ruleMatches,
    type CallableSignature,
    type ConstructorReturnValue,
    type ConstructorSignature,
    type InvocationKind,
    type RuntimeBehavior,
    type RuntimeConfiguration,
    type RuntimeFallback,
    type RuntimeRule
} from './double-behavior.ts';
import {
    createDoubleHistory,
    type DoubleHistory,
    type RuntimeDoubleHistory
} from './double-history.ts';
import {
    type ChronologyScope,
    type DoubleChronology,
    installDoubleChronology
} from './double-chronology.ts';
import {
    createReturnedResult,
    createThrownResult,
    type HistoryInvocation
} from './double-history-record.ts';

type InvocationRecord = {
    readonly arguments: readonly unknown[];
    readonly index: number;
    readonly kind: InvocationKind;
};

type RuntimeInvocation<Kind extends InvocationKind = InvocationKind> = HistoryInvocation<Kind> & {
    readonly chronologyOrder: number;
};

export type SupportedModes = ReadonlySet<InvocationKind>;

type DoubleRuntimeState = BehaviorRuntime & {
    readonly reset: () => void;
};

type DoubleExecutionContext = {
    readonly configuration: RuntimeConfiguration;
    readonly chronology: DoubleChronology;
    readonly history: RuntimeDoubleHistory;
    readonly runtime: BehaviorRuntime;
    readonly supportedModes: SupportedModes;
};

type RuntimeTestDouble<Signature> = DoubleHistory<Signature> & Signature;

export function modeSet(...modes: readonly InvocationKind[]): SupportedModes {
    return new Set(modes);
}

function assertTestDouble<Signature extends CallableSignature | ConstructorSignature>(
    value: unknown
): asserts value is RuntimeTestDouble<Signature> {
    if (!isUnknownFunction(value)) {
        throw new TypeError('Expected double factory to create a function.');
    }
}

function createDoubleRuntimeState(): DoubleRuntimeState {
    const sequenceIndexes = new Map<RuntimeBehavior, number>();

    return {
        nextSequenceEntry(behavior) {
            const index = sequenceIndexes.get(behavior) ?? 0;
            const entry = behavior.behaviorKind === 'sequence' ? behavior.entries[index] : undefined;

            if (entry !== undefined) {
                sequenceIndexes.set(behavior, index + 1);
            }

            return entry;
        },
        reset() {
            sequenceIndexes.clear();
        }
    };
}

function answerFromMatchingRules(
    rules: readonly RuntimeRule[],
    invocation: InvocationRecord,
    runtime: BehaviorRuntime
): BehaviorAnswer {
    for (const configuredRule of rules) {
        const answer = ruleMatches(configuredRule, invocation)
            ? answerFromBehavior(configuredRule.behavior, invocation, runtime)
            : { answered: false as const };

        if (answer.answered) {
            return answer;
        }
    }

    return { answered: false as const };
}

function answerFromFallback(
    fallback: RuntimeFallback | null,
    invocation: InvocationRecord,
    runtime: BehaviorRuntime
): BehaviorAnswer {
    if (fallback === null) {
        return { answered: false as const };
    }

    const fallbackBehavior = fallbackForInvocation(fallback, invocation);

    return fallbackBehavior === null
        ? { answered: false as const }
        : answerFromBehavior(fallbackBehavior, invocation, runtime);
}

function answerFromRules(
    configuration: RuntimeConfiguration,
    invocation: InvocationRecord,
    runtime: BehaviorRuntime
): BehaviorAnswer {
    const ruleAnswer = answerFromMatchingRules(configuration.rules, invocation, runtime);

    if (ruleAnswer.answered) {
        return ruleAnswer;
    }

    const fallbackAnswer = answerFromFallback(configuration.fallback, invocation, runtime);

    if (fallbackAnswer.answered || configuration.answer === null) {
        return fallbackAnswer;
    }

    return {
        answered: true,
        value: configuration.answer(invocation)
    };
}

function behaviorInvocationFrom(invocation: HistoryInvocation): InvocationRecord {
    return {
        arguments: invocation.arguments,
        index: invocation.index,
        kind: invocation.kind
    };
}

function answerForInvocation(
    context: DoubleExecutionContext,
    invocation: HistoryInvocation,
    missingBehaviorMessage: string
): unknown {
    const answer = answerFromRules(context.configuration, behaviorInvocationFrom(invocation), context.runtime);

    if (!answer.answered) {
        throw new TypeError(missingBehaviorMessage);
    }

    return answer.value;
}

function createCallInvocation(
    chronologyScope: ChronologyScope,
    history: RuntimeDoubleHistory,
    argumentList: ArrayLike<unknown>
): RuntimeInvocation<'call'> {
    return {
        arguments: Array.from(argumentList),
        chronologyOrder: chronologyScope.nextOrder(),
        index: history.callIndex(),
        kind: 'call',
        order: history.interactionOrder()
    };
}

function createConstructionInvocation(
    chronologyScope: ChronologyScope,
    history: RuntimeDoubleHistory,
    argumentList: ArrayLike<unknown>
): RuntimeInvocation<'construction'> {
    return {
        arguments: Array.from(argumentList),
        chronologyOrder: chronologyScope.nextOrder(),
        index: history.constructionIndex(),
        kind: 'construction',
        order: history.interactionOrder()
    };
}

function unsupportedCall(
    context: DoubleExecutionContext,
    invocation: RuntimeInvocation<'call'>,
    thisValue: unknown
): never {
    const error = new TypeError('Class constructor TestDouble cannot be invoked without new.');
    context.history.recordCallResult(invocation, thisValue, createThrownResult(invocation, error));
    context.chronology.record({ kind: invocation.kind, order: invocation.chronologyOrder });
    throw error;
}

function unsupportedConstruction(
    context: DoubleExecutionContext,
    invocation: RuntimeInvocation<'construction'>
): never {
    const error = new TypeError('test double is not a constructor.');
    context.history.recordConstructionResult(invocation, null, createThrownResult(invocation, error));
    context.chronology.record({ kind: invocation.kind, order: invocation.chronologyOrder });
    throw error;
}

function answerCall(
    context: DoubleExecutionContext,
    invocation: RuntimeInvocation<'call'>,
    thisValue: unknown
): unknown {
    try {
        const answer = answerForInvocation(
            context,
            invocation,
            'test double has no configured behavior for this call.'
        );
        context.history.recordCallResult(invocation, thisValue, createReturnedResult(invocation, answer));
        context.chronology.record({ kind: invocation.kind, order: invocation.chronologyOrder });
        return answer;
    } catch (error: unknown) {
        context.history.recordCallResult(invocation, thisValue, createThrownResult(invocation, error));
        context.chronology.record({ kind: invocation.kind, order: invocation.chronologyOrder });
        throw error;
    }
}

function answerConstruction(
    context: DoubleExecutionContext,
    invocation: RuntimeInvocation<'construction'>
): ConstructorReturnValue {
    const answer = answerForInvocation(
        context,
        invocation,
        'test double has no configured behavior for this construction.'
    );

    if (!isConstructorInstance(answer)) {
        throw new TypeError('test double constructor behavior must return an object instance.');
    }

    return answer;
}

function constructDouble(
    context: DoubleExecutionContext,
    invocation: RuntimeInvocation<'construction'>
): ConstructorReturnValue {
    try {
        const answer = answerConstruction(context, invocation);
        context.history.recordConstructionResult(invocation, answer, createReturnedResult(invocation, answer));
        context.chronology.record({ kind: invocation.kind, order: invocation.chronologyOrder });
        return answer;
    } catch (error: unknown) {
        context.history.recordConstructionResult(invocation, null, createThrownResult(invocation, error));
        context.chronology.record({ kind: invocation.kind, order: invocation.chronologyOrder });
        throw error;
    }
}

function createDoubleTarget(): (...arguments_: readonly unknown[]) => never {
    return function TestDouble(): never {
        throw new TypeError('test double target should not be reached.');
    };
}

export function createDouble<Signature extends CallableSignature | ConstructorSignature>(
    configuration: RuntimeConfiguration,
    chronologyScope: ChronologyScope,
    supportedModes: SupportedModes
): RuntimeTestDouble<Signature> {
    const runtime = createDoubleRuntimeState();
    const target = createDoubleTarget();
    const chronology = installDoubleChronology(target, chronologyScope);
    const history = createDoubleHistory(function resetDouble() {
        chronology.reset();
        runtime.reset();
    });
    const context = { chronology, configuration, history, runtime, supportedModes };
    history.install(target);

    const candidate: unknown = new Proxy(target, {
        apply(_target, thisArgument, argumentList): unknown {
            const invocation = createCallInvocation(chronologyScope, history, argumentList);
            return supportedModes.has('call') ? answerCall(context, invocation, thisArgument) : unsupportedCall(
                context,
                invocation,
                thisArgument
            );
        },
        construct(_target, argumentList): ConstructorReturnValue {
            const invocation = createConstructionInvocation(chronologyScope, history, argumentList);
            return supportedModes.has('construction') ? constructDouble(context, invocation) : unsupportedConstruction(
                context,
                invocation
            );
        }
    });

    assertTestDouble<Signature>(candidate);

    return candidate;
}

import {
    type BehaviorMode,
    type CallableSignature,
    callsBehavior,
    constructsBehavior,
    rejectsBehavior,
    resolvesBehavior,
    type RuntimeFixedBehavior,
    type RuntimeBehavior,
    returnsBehavior,
    sequenceBehavior,
    throwsBehavior
} from './double-behavior.ts';
import {
    callsCallbackAsyncBehavior,
    callsCallbackBehavior,
    createAsyncCallbackRuleTerminator,
    createCallbackRuleTerminator
} from './double-rule-callback.ts';
import {
    createAsyncYieldingBehavior,
    createAsyncYieldingFromBehavior,
    createAsyncYieldingFromRuleTerminator,
    createAsyncYieldingRuleTerminator,
    createYieldingBehavior,
    createYieldingFromBehavior,
    createYieldingFromRuleTerminator,
    createYieldingRuleTerminator
} from './double-rule-generator.ts';
import type {
    CallRule,
    CallRuleStarter,
    ConstructInstance,
    ConstructionRule,
    ConstructionRuleStarter,
    ReturnArguments,
    RuleFactory,
    SequenceResult
} from './double-rule-types.ts';

function callRule<
    ArgumentPattern extends readonly unknown[],
    Result,
    MatchKind extends 'arguments' | 'index',
    Behavior extends RuntimeBehavior<BehaviorMode, Result> = RuntimeBehavior<BehaviorMode, Result>
>(
    criterion: CallRule<ArgumentPattern, Result, MatchKind>['criterion'],
    behavior: Behavior
): CallRule<ArgumentPattern, Result, MatchKind, Behavior> {
    return { behavior, criterion };
}

function constructionRule<
    ArgumentPattern extends readonly unknown[],
    Result,
    MatchKind extends 'arguments' | 'index',
    Behavior extends RuntimeBehavior<BehaviorMode, Result> = RuntimeBehavior<BehaviorMode, Result>
>(
    criterion: ConstructionRule<ArgumentPattern, Result, MatchKind>['criterion'],
    behavior: Behavior
): ConstructionRule<ArgumentPattern, Result, MatchKind, Behavior> {
    return { behavior, criterion };
}

function createCallRuleStarter<ArgumentPattern extends readonly unknown[], MatchKind extends 'arguments' | 'index'>(
    criterion: CallRule<ArgumentPattern, unknown, MatchKind>['criterion']
): CallRuleStarter<ArgumentPattern, MatchKind> {
    return {
        calls(answer) {
            return callRule(criterion, callsBehavior(answer));
        },
        callsCallback: createCallbackRuleTerminator(criterion),
        callsCallbackAsync: createAsyncCallbackRuleTerminator(criterion),
        rejects(reason: unknown) {
            return callRule(criterion, rejectsBehavior(reason));
        },
        resolves(value) {
            return callRule(criterion, resolvesBehavior(value));
        },
        returns(...value: readonly unknown[]) {
            return callRule(criterion, returnsBehavior(value[0]));
        },
        sequence(entries) {
            const behavior = sequenceBehavior<typeof entries, SequenceResult<typeof entries[number]>>(entries);

            return callRule<ArgumentPattern, SequenceResult<typeof entries[number]>, MatchKind, typeof behavior>(
                criterion,
                behavior
            );
        },
        throws(thrown) {
            return callRule(criterion, throwsBehavior(thrown));
        },
        yields: createYieldingRuleTerminator(criterion),
        yieldsAsync: createAsyncYieldingRuleTerminator(criterion),
        yieldsAsyncFrom: createAsyncYieldingFromRuleTerminator(criterion),
        yieldsFrom: createYieldingFromRuleTerminator(criterion)
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
            return constructionRule(criterion, callsBehavior(answer));
        },
        constructs<SignatureOrInstance>(instance: ConstructInstance<SignatureOrInstance>) {
            const behavior = constructsBehavior<ConstructInstance<SignatureOrInstance>>(instance);

            return constructionRule<
                ArgumentPattern,
                ConstructInstance<SignatureOrInstance>,
                MatchKind,
                typeof behavior
            >(
                criterion,
                behavior
            );
        },
        sequence(entries) {
            const behavior = sequenceBehavior<typeof entries, SequenceResult<typeof entries[number]>>(entries);

            return constructionRule<
                ArgumentPattern,
                SequenceResult<typeof entries[number]>,
                MatchKind,
                typeof behavior
            >(
                criterion,
                behavior
            );
        },
        throws(thrown) {
            return constructionRule(criterion, throwsBehavior(thrown));
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

function createReturningBehavior(): RuntimeFixedBehavior<'call', void, 'returns'>;
function createReturningBehavior<SignatureOrValue>(
    ...value: ReturnArguments<SignatureOrValue>
): RuntimeFixedBehavior<
    'call',
    SignatureOrValue extends CallableSignature ? ReturnType<SignatureOrValue> : SignatureOrValue,
    'returns'
>;
function createReturningBehavior(...value: readonly unknown[]): RuntimeFixedBehavior<'call', unknown, 'returns'> {
    return returnsBehavior(value[0]);
}

export const rule: RuleFactory = {
    calls: callsBehavior,
    callsCallback: callsCallbackBehavior,
    callsCallbackAsync: callsCallbackAsyncBehavior,
    constructs: constructsBehavior,
    onCall: createCallIndexRuleStarter,
    onConstruction: createConstructionIndexRuleStarter,
    rejects: rejectsBehavior,
    resolves: resolvesBehavior,
    returns: createReturningBehavior,
    sequence: sequenceBehavior,
    throws: throwsBehavior,
    yields: createYieldingBehavior,
    yieldsAsync: createAsyncYieldingBehavior,
    yieldsAsyncFrom: createAsyncYieldingFromBehavior,
    yieldsFrom: createYieldingFromBehavior,
    when: createCallArgumentRuleStarter,
    whenConstructedWith: createConstructionArgumentRuleStarter
};

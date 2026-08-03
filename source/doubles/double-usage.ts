import {
    argumentPrefixReference,
    argumentReference,
    indexedArgumentPrefixReference,
    indexedArgumentReference
} from './double-usage-argument-assertion.ts';
import {
    atLeastOneReference,
    countReference,
    noEventsReference,
    onceReference
} from './double-usage-count-assertion.ts';
import {
    disposedOnceReference,
    disposedReference,
    disposeCountReference,
    disposeOrderReference,
    notDisposedReference
} from './double-usage-disposal-assertion.ts';
import {
    iteratedReference,
    iteratorEventCountReference,
    notIteratedReference,
    yieldCountReference,
    yieldedExactlyReference
} from './double-usage-iterator-assertion.ts';
import {
    orderReference
} from './double-usage-order-assertion.ts';
import type {
    AggregateArguments,
    AggregateIndexedArguments,
    AggregateIndexedPrefixArguments,
    AggregatePrefixArguments,
    CountArguments,
    IteratorValuesArguments,
    OrderArguments,
    UsageAssertionReference,
    ValueArguments
} from './double-usage-contract.ts';

type CountReference = UsageAssertionReference<CountArguments>;
type IteratorValuesReference = UsageAssertionReference<IteratorValuesArguments>;
type ValueReference = UsageAssertionReference<ValueArguments>;
type OrderReference = UsageAssertionReference<OrderArguments>;
type ArgumentReference = UsageAssertionReference<AggregateArguments>;
type PrefixReference = UsageAssertionReference<AggregatePrefixArguments>;
type IndexedArgumentReference = UsageAssertionReference<AggregateIndexedArguments>;
type IndexedPrefixReference = UsageAssertionReference<AggregateIndexedPrefixArguments>;

export type DoubleUsageAssertions = {
    readonly callCount: CountReference;
    readonly callOrder: OrderReference;
    readonly called: ValueReference;
    readonly calledOnce: ValueReference;
    readonly calledOnceWith: ArgumentReference;
    readonly calledOnceWithExactly: ArgumentReference;
    readonly calledOnceWithPrefix: PrefixReference;
    readonly calledWith: ArgumentReference;
    readonly calledWithExactly: ArgumentReference;
    readonly calledWithPrefix: PrefixReference;
    readonly constructed: ValueReference;
    readonly constructedOnce: ValueReference;
    readonly constructedOnceWith: ArgumentReference;
    readonly constructedOnceWithExactly: ArgumentReference;
    readonly constructedOnceWithPrefix: PrefixReference;
    readonly constructedWith: ArgumentReference;
    readonly constructedWithExactly: ArgumentReference;
    readonly constructedWithPrefix: PrefixReference;
    readonly constructionCount: CountReference;
    readonly constructionOrder: OrderReference;
    readonly disposeCount: CountReference;
    readonly disposeOrder: OrderReference;
    readonly disposed: ValueReference;
    readonly disposedOnce: ValueReference;
    readonly interacted: ValueReference;
    readonly interactedOnce: ValueReference;
    readonly interactedOnceWith: ArgumentReference;
    readonly interactedOnceWithExactly: ArgumentReference;
    readonly interactedOnceWithPrefix: PrefixReference;
    readonly interactedWith: ArgumentReference;
    readonly interactedWithExactly: ArgumentReference;
    readonly interactedWithPrefix: PrefixReference;
    readonly iterated: ValueReference;
    readonly iteratorEventCount: CountReference;
    readonly interactionCount: CountReference;
    readonly interactionOrder: OrderReference;
    readonly lastCalledWith: ArgumentReference;
    readonly lastCalledWithExactly: ArgumentReference;
    readonly lastCalledWithPrefix: PrefixReference;
    readonly lastConstructedWith: ArgumentReference;
    readonly lastConstructedWithExactly: ArgumentReference;
    readonly lastConstructedWithPrefix: PrefixReference;
    readonly lastInteractedWith: ArgumentReference;
    readonly lastInteractedWithExactly: ArgumentReference;
    readonly lastInteractedWithPrefix: PrefixReference;
    readonly notCalled: ValueReference;
    readonly notCalledWith: ArgumentReference;
    readonly notCalledWithPrefix: PrefixReference;
    readonly notConstructed: ValueReference;
    readonly notConstructedWith: ArgumentReference;
    readonly notConstructedWithPrefix: PrefixReference;
    readonly notDisposed: ValueReference;
    readonly notInteracted: ValueReference;
    readonly notInteractedWith: ArgumentReference;
    readonly notInteractedWithPrefix: PrefixReference;
    readonly notIterated: ValueReference;
    readonly nthCallWith: IndexedArgumentReference;
    readonly nthCallWithExactly: IndexedArgumentReference;
    readonly nthCallWithPrefix: IndexedPrefixReference;
    readonly nthConstructionWith: IndexedArgumentReference;
    readonly nthConstructionWithExactly: IndexedArgumentReference;
    readonly nthConstructionWithPrefix: IndexedPrefixReference;
    readonly nthInteractionWith: IndexedArgumentReference;
    readonly nthInteractionWithExactly: IndexedArgumentReference;
    readonly nthInteractionWithPrefix: IndexedPrefixReference;
    readonly yieldCount: CountReference;
    readonly yieldedExactly: IteratorValuesReference;
};

export const doubleUsage: DoubleUsageAssertions = {
    callCount: countReference('doubleUsage.callCount', 'call'),
    callOrder: orderReference('doubleUsage.callOrder', 'call'),
    called: atLeastOneReference('doubleUsage.called', 'call'),
    calledOnce: onceReference('doubleUsage.calledOnce', 'call'),
    calledOnceWith: argumentReference('doubleUsage.calledOnceWith', {
        match: 'partial',
        mode: 'call',
        negative: false,
        position: 'once'
    }),
    calledOnceWithExactly: argumentReference('doubleUsage.calledOnceWithExactly', {
        match: 'exact',
        mode: 'call',
        negative: false,
        position: 'once'
    }),
    calledOnceWithPrefix: argumentPrefixReference('doubleUsage.calledOnceWithPrefix', {
        mode: 'call',
        negative: false,
        position: 'once'
    }),
    calledWith: argumentReference('doubleUsage.calledWith', {
        match: 'partial',
        mode: 'call',
        negative: false,
        position: 'any'
    }),
    calledWithExactly: argumentReference('doubleUsage.calledWithExactly', {
        match: 'exact',
        mode: 'call',
        negative: false,
        position: 'any'
    }),
    calledWithPrefix: argumentPrefixReference('doubleUsage.calledWithPrefix', {
        mode: 'call',
        negative: false,
        position: 'any'
    }),
    constructed: atLeastOneReference('doubleUsage.constructed', 'construction'),
    constructedOnce: onceReference('doubleUsage.constructedOnce', 'construction'),
    constructedOnceWith: argumentReference('doubleUsage.constructedOnceWith', {
        match: 'partial',
        mode: 'construction',
        negative: false,
        position: 'once'
    }),
    constructedOnceWithExactly: argumentReference('doubleUsage.constructedOnceWithExactly', {
        match: 'exact',
        mode: 'construction',
        negative: false,
        position: 'once'
    }),
    constructedOnceWithPrefix: argumentPrefixReference('doubleUsage.constructedOnceWithPrefix', {
        mode: 'construction',
        negative: false,
        position: 'once'
    }),
    constructedWith: argumentReference('doubleUsage.constructedWith', {
        match: 'partial',
        mode: 'construction',
        negative: false,
        position: 'any'
    }),
    constructedWithExactly: argumentReference('doubleUsage.constructedWithExactly', {
        match: 'exact',
        mode: 'construction',
        negative: false,
        position: 'any'
    }),
    constructedWithPrefix: argumentPrefixReference('doubleUsage.constructedWithPrefix', {
        mode: 'construction',
        negative: false,
        position: 'any'
    }),
    constructionCount: countReference('doubleUsage.constructionCount', 'construction'),
    constructionOrder: orderReference('doubleUsage.constructionOrder', 'construction'),
    disposeCount: disposeCountReference('doubleUsage.disposeCount'),
    disposeOrder: disposeOrderReference('doubleUsage.disposeOrder'),
    disposed: disposedReference('doubleUsage.disposed'),
    disposedOnce: disposedOnceReference('doubleUsage.disposedOnce'),
    interacted: atLeastOneReference('doubleUsage.interacted', 'interaction'),
    interactedOnce: onceReference('doubleUsage.interactedOnce', 'interaction'),
    interactedOnceWith: argumentReference('doubleUsage.interactedOnceWith', {
        match: 'partial',
        mode: 'interaction',
        negative: false,
        position: 'once'
    }),
    interactedOnceWithExactly: argumentReference('doubleUsage.interactedOnceWithExactly', {
        match: 'exact',
        mode: 'interaction',
        negative: false,
        position: 'once'
    }),
    interactedOnceWithPrefix: argumentPrefixReference('doubleUsage.interactedOnceWithPrefix', {
        mode: 'interaction',
        negative: false,
        position: 'once'
    }),
    interactedWith: argumentReference('doubleUsage.interactedWith', {
        match: 'partial',
        mode: 'interaction',
        negative: false,
        position: 'any'
    }),
    interactedWithExactly: argumentReference('doubleUsage.interactedWithExactly', {
        match: 'exact',
        mode: 'interaction',
        negative: false,
        position: 'any'
    }),
    interactedWithPrefix: argumentPrefixReference('doubleUsage.interactedWithPrefix', {
        mode: 'interaction',
        negative: false,
        position: 'any'
    }),
    iterated: iteratedReference('doubleUsage.iterated'),
    iteratorEventCount: iteratorEventCountReference('doubleUsage.iteratorEventCount'),
    interactionCount: countReference('doubleUsage.interactionCount', 'interaction'),
    interactionOrder: orderReference('doubleUsage.interactionOrder', 'interaction'),
    lastCalledWith: argumentReference('doubleUsage.lastCalledWith', {
        match: 'partial',
        mode: 'call',
        negative: false,
        position: 'last'
    }),
    lastCalledWithExactly: argumentReference('doubleUsage.lastCalledWithExactly', {
        match: 'exact',
        mode: 'call',
        negative: false,
        position: 'last'
    }),
    lastCalledWithPrefix: argumentPrefixReference('doubleUsage.lastCalledWithPrefix', {
        mode: 'call',
        negative: false,
        position: 'last'
    }),
    lastConstructedWith: argumentReference('doubleUsage.lastConstructedWith', {
        match: 'partial',
        mode: 'construction',
        negative: false,
        position: 'last'
    }),
    lastConstructedWithExactly: argumentReference('doubleUsage.lastConstructedWithExactly', {
        match: 'exact',
        mode: 'construction',
        negative: false,
        position: 'last'
    }),
    lastConstructedWithPrefix: argumentPrefixReference('doubleUsage.lastConstructedWithPrefix', {
        mode: 'construction',
        negative: false,
        position: 'last'
    }),
    lastInteractedWith: argumentReference('doubleUsage.lastInteractedWith', {
        match: 'partial',
        mode: 'interaction',
        negative: false,
        position: 'last'
    }),
    lastInteractedWithExactly: argumentReference('doubleUsage.lastInteractedWithExactly', {
        match: 'exact',
        mode: 'interaction',
        negative: false,
        position: 'last'
    }),
    lastInteractedWithPrefix: argumentPrefixReference('doubleUsage.lastInteractedWithPrefix', {
        mode: 'interaction',
        negative: false,
        position: 'last'
    }),
    notCalled: noEventsReference('doubleUsage.notCalled', 'call'),
    notCalledWith: argumentReference('doubleUsage.notCalledWith', {
        match: 'partial',
        mode: 'call',
        negative: true,
        position: 'any'
    }),
    notCalledWithPrefix: argumentPrefixReference('doubleUsage.notCalledWithPrefix', {
        mode: 'call',
        negative: true,
        position: 'any'
    }),
    notConstructed: noEventsReference('doubleUsage.notConstructed', 'construction'),
    notConstructedWith: argumentReference('doubleUsage.notConstructedWith', {
        match: 'partial',
        mode: 'construction',
        negative: true,
        position: 'any'
    }),
    notConstructedWithPrefix: argumentPrefixReference('doubleUsage.notConstructedWithPrefix', {
        mode: 'construction',
        negative: true,
        position: 'any'
    }),
    notDisposed: notDisposedReference('doubleUsage.notDisposed'),
    notInteracted: noEventsReference('doubleUsage.notInteracted', 'interaction'),
    notInteractedWith: argumentReference('doubleUsage.notInteractedWith', {
        match: 'partial',
        mode: 'interaction',
        negative: true,
        position: 'any'
    }),
    notInteractedWithPrefix: argumentPrefixReference('doubleUsage.notInteractedWithPrefix', {
        mode: 'interaction',
        negative: true,
        position: 'any'
    }),
    notIterated: notIteratedReference('doubleUsage.notIterated'),
    nthCallWith: indexedArgumentReference('doubleUsage.nthCallWith', 'call', 'partial'),
    nthCallWithExactly: indexedArgumentReference('doubleUsage.nthCallWithExactly', 'call', 'exact'),
    nthCallWithPrefix: indexedArgumentPrefixReference('doubleUsage.nthCallWithPrefix', 'call'),
    nthConstructionWith: indexedArgumentReference('doubleUsage.nthConstructionWith', 'construction', 'partial'),
    nthConstructionWithExactly: indexedArgumentReference(
        'doubleUsage.nthConstructionWithExactly',
        'construction',
        'exact'
    ),
    nthConstructionWithPrefix: indexedArgumentPrefixReference(
        'doubleUsage.nthConstructionWithPrefix',
        'construction'
    ),
    nthInteractionWith: indexedArgumentReference('doubleUsage.nthInteractionWith', 'interaction', 'partial'),
    nthInteractionWithExactly: indexedArgumentReference(
        'doubleUsage.nthInteractionWithExactly',
        'interaction',
        'exact'
    ),
    nthInteractionWithPrefix: indexedArgumentPrefixReference('doubleUsage.nthInteractionWithPrefix', 'interaction'),
    yieldCount: yieldCountReference('doubleUsage.yieldCount'),
    yieldedExactly: yieldedExactlyReference('doubleUsage.yieldedExactly')
};

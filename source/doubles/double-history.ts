import type {
    CallableSignature,
    ConstructorReturnValue,
    ConstructorSignature
} from './double-behavior.ts';
import {
    createCallRecord,
    createConstructionRecord,
    type DoubleCall,
    type DoubleConstruction,
    type DoubleResult,
    type HistoryInvocation
} from './double-history-record.ts';
import {
    createHistoryApi,
    installHistory,
    type MutableDoubleHistory
} from './double-history-api.ts';
import { createHistoryStore, type HistoryStore } from './double-history-store.ts';
import {
    type AsyncIteratorSource,
    createAsyncTrackedIterator,
    createSyncTrackedIterator,
    type SyncIteratorSource,
    type TrackedCallInvocation
} from './double-iterator-tracking.ts';
import type { IteratorEventFor } from './double-iterator-event-types.ts';

type CallArguments<Signature> = Signature extends (...arguments_: infer Arguments) => unknown ? Arguments : never;
type ConstructionArguments<Signature> = Signature extends new (...arguments_: infer Arguments) => unknown ? Arguments
    : never;
type CallReturn<Signature> = Signature extends (...arguments_: readonly never[]) => infer ReturnValue ? ReturnValue
    : never;
type ConstructionInstance<Signature> = Signature extends new (...arguments_: readonly never[]) => infer Instance
    ? Instance
    : never;
type CallThisValue<Signature> = ThisParameterType<Signature>;

type CallableOverloadRecordUnion<
    Arguments1 extends readonly unknown[],
    ReturnValue1,
    ThisValue1,
    Arguments2 extends readonly unknown[],
    ReturnValue2,
    ThisValue2,
    Arguments3 extends readonly unknown[],
    ReturnValue3,
    ThisValue3,
    Arguments4 extends readonly unknown[],
    ReturnValue4,
    ThisValue4,
    Arguments5 extends readonly unknown[],
    ReturnValue5,
    ThisValue5,
    Arguments6 extends readonly unknown[],
    ReturnValue6,
    ThisValue6,
    Arguments7 extends readonly unknown[],
    ReturnValue7,
    ThisValue7,
    Arguments8 extends readonly unknown[],
    ReturnValue8,
    ThisValue8,
    Arguments9 extends readonly unknown[],
    ReturnValue9,
    ThisValue9,
    Arguments10 extends readonly unknown[],
    ReturnValue10,
    ThisValue10,
    Arguments11 extends readonly unknown[],
    ReturnValue11,
    ThisValue11,
    Arguments12 extends readonly unknown[],
    ReturnValue12,
    ThisValue12
> = {
    readonly overload01: DoubleCall<Arguments1, ReturnValue1, ThisValue1>;
    readonly overload02: DoubleCall<Arguments2, ReturnValue2, ThisValue2>;
    readonly overload03: DoubleCall<Arguments3, ReturnValue3, ThisValue3>;
    readonly overload04: DoubleCall<Arguments4, ReturnValue4, ThisValue4>;
    readonly overload05: DoubleCall<Arguments5, ReturnValue5, ThisValue5>;
    readonly overload06: DoubleCall<Arguments6, ReturnValue6, ThisValue6>;
    readonly overload07: DoubleCall<Arguments7, ReturnValue7, ThisValue7>;
    readonly overload08: DoubleCall<Arguments8, ReturnValue8, ThisValue8>;
    readonly overload09: DoubleCall<Arguments9, ReturnValue9, ThisValue9>;
    readonly overload10: DoubleCall<Arguments10, ReturnValue10, ThisValue10>;
    readonly overload11: DoubleCall<Arguments11, ReturnValue11, ThisValue11>;
    readonly overload12: DoubleCall<Arguments12, ReturnValue12, ThisValue12>;
}[
    keyof {
        readonly overload01: unknown;
        readonly overload02: unknown;
        readonly overload03: unknown;
        readonly overload04: unknown;
        readonly overload05: unknown;
        readonly overload06: unknown;
        readonly overload07: unknown;
        readonly overload08: unknown;
        readonly overload09: unknown;
        readonly overload10: unknown;
        readonly overload11: unknown;
        readonly overload12: unknown;
    }
];

type CallableOverloadRecords<Signature> = Signature extends {
    (this: infer ThisValue1, ...arguments_: infer Arguments1): infer ReturnValue1;
    (this: infer ThisValue2, ...arguments_: infer Arguments2): infer ReturnValue2;
    (this: infer ThisValue3, ...arguments_: infer Arguments3): infer ReturnValue3;
    (this: infer ThisValue4, ...arguments_: infer Arguments4): infer ReturnValue4;
    (this: infer ThisValue5, ...arguments_: infer Arguments5): infer ReturnValue5;
    (this: infer ThisValue6, ...arguments_: infer Arguments6): infer ReturnValue6;
    (this: infer ThisValue7, ...arguments_: infer Arguments7): infer ReturnValue7;
    (this: infer ThisValue8, ...arguments_: infer Arguments8): infer ReturnValue8;
    (this: infer ThisValue9, ...arguments_: infer Arguments9): infer ReturnValue9;
    (this: infer ThisValue10, ...arguments_: infer Arguments10): infer ReturnValue10;
    (this: infer ThisValue11, ...arguments_: infer Arguments11): infer ReturnValue11;
    (this: infer ThisValue12, ...arguments_: infer Arguments12): infer ReturnValue12;
} ? CallableOverloadRecordUnion<
        Arguments1,
        ReturnValue1,
        ThisValue1,
        Arguments2,
        ReturnValue2,
        ThisValue2,
        Arguments3,
        ReturnValue3,
        ThisValue3,
        Arguments4,
        ReturnValue4,
        ThisValue4,
        Arguments5,
        ReturnValue5,
        ThisValue5,
        Arguments6,
        ReturnValue6,
        ThisValue6,
        Arguments7,
        ReturnValue7,
        ThisValue7,
        Arguments8,
        ReturnValue8,
        ThisValue8,
        Arguments9,
        ReturnValue9,
        ThisValue9,
        Arguments10,
        ReturnValue10,
        ThisValue10,
        Arguments11,
        ReturnValue11,
        ThisValue11,
        Arguments12,
        ReturnValue12,
        ThisValue12
    >
    : never;

type SingleCallRecord<Signature> = Signature extends CallableSignature
    ? DoubleCall<CallArguments<Signature>, CallReturn<Signature>, CallThisValue<Signature>>
    : never;

type KnownCallRecord<Signature> = CallableOverloadRecords<Signature> extends never ? SingleCallRecord<Signature>
    : CallableOverloadRecords<Signature>;

type CallRecordFor<Signature> = KnownCallRecord<Signature> extends never ? DoubleCall
    : KnownCallRecord<Signature>;

type ConstructableOverloadRecordUnion<
    Arguments1 extends readonly unknown[],
    Instance1,
    Arguments2 extends readonly unknown[],
    Instance2,
    Arguments3 extends readonly unknown[],
    Instance3,
    Arguments4 extends readonly unknown[],
    Instance4,
    Arguments5 extends readonly unknown[],
    Instance5,
    Arguments6 extends readonly unknown[],
    Instance6,
    Arguments7 extends readonly unknown[],
    Instance7,
    Arguments8 extends readonly unknown[],
    Instance8,
    Arguments9 extends readonly unknown[],
    Instance9,
    Arguments10 extends readonly unknown[],
    Instance10,
    Arguments11 extends readonly unknown[],
    Instance11,
    Arguments12 extends readonly unknown[],
    Instance12
> = {
    readonly overload01: DoubleConstruction<Arguments1, Instance1>;
    readonly overload02: DoubleConstruction<Arguments2, Instance2>;
    readonly overload03: DoubleConstruction<Arguments3, Instance3>;
    readonly overload04: DoubleConstruction<Arguments4, Instance4>;
    readonly overload05: DoubleConstruction<Arguments5, Instance5>;
    readonly overload06: DoubleConstruction<Arguments6, Instance6>;
    readonly overload07: DoubleConstruction<Arguments7, Instance7>;
    readonly overload08: DoubleConstruction<Arguments8, Instance8>;
    readonly overload09: DoubleConstruction<Arguments9, Instance9>;
    readonly overload10: DoubleConstruction<Arguments10, Instance10>;
    readonly overload11: DoubleConstruction<Arguments11, Instance11>;
    readonly overload12: DoubleConstruction<Arguments12, Instance12>;
}[
    keyof {
        readonly overload01: unknown;
        readonly overload02: unknown;
        readonly overload03: unknown;
        readonly overload04: unknown;
        readonly overload05: unknown;
        readonly overload06: unknown;
        readonly overload07: unknown;
        readonly overload08: unknown;
        readonly overload09: unknown;
        readonly overload10: unknown;
        readonly overload11: unknown;
        readonly overload12: unknown;
    }
];

type ConstructableOverloadRecords<Signature> = Signature extends {
    new (...arguments_: infer Arguments1): infer Instance1;
    new (...arguments_: infer Arguments2): infer Instance2;
    new (...arguments_: infer Arguments3): infer Instance3;
    new (...arguments_: infer Arguments4): infer Instance4;
    new (...arguments_: infer Arguments5): infer Instance5;
    new (...arguments_: infer Arguments6): infer Instance6;
    new (...arguments_: infer Arguments7): infer Instance7;
    new (...arguments_: infer Arguments8): infer Instance8;
    new (...arguments_: infer Arguments9): infer Instance9;
    new (...arguments_: infer Arguments10): infer Instance10;
    new (...arguments_: infer Arguments11): infer Instance11;
    new (...arguments_: infer Arguments12): infer Instance12;
} ? ConstructableOverloadRecordUnion<
        Arguments1,
        Instance1,
        Arguments2,
        Instance2,
        Arguments3,
        Instance3,
        Arguments4,
        Instance4,
        Arguments5,
        Instance5,
        Arguments6,
        Instance6,
        Arguments7,
        Instance7,
        Arguments8,
        Instance8,
        Arguments9,
        Instance9,
        Arguments10,
        Instance10,
        Arguments11,
        Instance11,
        Arguments12,
        Instance12
    >
    : never;

type SingleConstructionRecord<Signature> = Signature extends ConstructorSignature
    ? DoubleConstruction<ConstructionArguments<Signature>, ConstructionInstance<Signature>>
    : never;

type KnownConstructionRecord<Signature> = ConstructableOverloadRecords<Signature> extends never
    ? SingleConstructionRecord<Signature>
    : ConstructableOverloadRecords<Signature>;

type ConstructionRecordFor<Signature> = KnownConstructionRecord<Signature> extends never ? DoubleConstruction
    : KnownConstructionRecord<Signature>;

type InteractionRecordFor<Signature> = CallRecordFor<Signature> | ConstructionRecordFor<Signature>;

type ResultValueFor<Signature> = CallReturn<Signature> | ConstructionInstance<Signature>;

type ResultRecordFor<Signature> = DoubleResult<
    ResultValueFor<Signature> extends never ? unknown : ResultValueFor<Signature>
>;

export type DoubleHistory<Signature> = {
    readonly callCount: number;
    readonly calls: readonly CallRecordFor<Signature>[];
    readonly constructionCount: number;
    readonly constructions: readonly ConstructionRecordFor<Signature>[];
    readonly firstCall: CallRecordFor<Signature> | null;
    readonly firstConstruction: ConstructionRecordFor<Signature> | null;
    readonly firstInteraction: InteractionRecordFor<Signature> | null;
    readonly firstIteratorEvent: IteratorEventFor<Signature> | null;
    readonly firstResult: ResultRecordFor<Signature> | null;
    readonly interactionCount: number;
    readonly interactions: readonly InteractionRecordFor<Signature>[];
    readonly iteratorEventCount: number;
    readonly iteratorEvents: readonly IteratorEventFor<Signature>[];
    readonly lastCall: CallRecordFor<Signature> | null;
    readonly lastConstruction: ConstructionRecordFor<Signature> | null;
    readonly lastInteraction: InteractionRecordFor<Signature> | null;
    readonly lastIteratorEvent: IteratorEventFor<Signature> | null;
    readonly lastResult: ResultRecordFor<Signature> | null;
    readonly nthCall: (index: number) => CallRecordFor<Signature> | null;
    readonly nthConstruction: (index: number) => ConstructionRecordFor<Signature> | null;
    readonly nthInteraction: (index: number) => InteractionRecordFor<Signature> | null;
    readonly nthIteratorEvent: (index: number) => IteratorEventFor<Signature> | null;
    readonly reset: () => void;
    readonly results: readonly ResultRecordFor<Signature>[];
};

export type RuntimeDoubleHistory = {
    readonly callIndex: () => number;
    readonly constructionIndex: () => number;
    readonly install: (target: UnknownFunctionTarget) => void;
    readonly interactionOrder: () => number;
    readonly recordCallResult: (
        invocation: HistoryInvocation<'call'>,
        thisValue: unknown,
        result: DoubleResult
    ) => void;
    readonly recordConstructionResult: (
        invocation: HistoryInvocation<'construction'>,
        instance: ConstructorReturnValue | null,
        result: DoubleResult
    ) => void;
    readonly reset: () => void;
    readonly trackAsyncIterator: (
        invocation: TrackedCallInvocation,
        source: AsyncIteratorSource
    ) => AsyncIterableIterator<unknown>;
    readonly trackSyncIterator: (
        invocation: TrackedCallInvocation,
        source: SyncIteratorSource
    ) => IterableIterator<unknown>;
};

type UnknownFunctionTarget = (...arguments_: readonly unknown[]) => unknown;

function createRuntimeHistory(store: HistoryStore, api: MutableDoubleHistory): RuntimeDoubleHistory {
    return {
        callIndex: store.callIndex,
        constructionIndex: store.constructionIndex,
        install(target) {
            installHistory(target, api);
        },
        interactionOrder: store.interactionOrder,
        recordCallResult(invocation, thisValue, result) {
            store.recordCall(createCallRecord(invocation, thisValue, result));
        },
        recordConstructionResult(invocation, instance, result) {
            store.recordConstruction(createConstructionRecord(invocation, instance, result));
        },
        reset: store.reset,
        trackAsyncIterator(invocation, source) {
            return createAsyncTrackedIterator(store, invocation, source);
        },
        trackSyncIterator(invocation, source) {
            return createSyncTrackedIterator(store, invocation, source);
        }
    };
}

export function createDoubleHistory(resetRuntimeState: () => void): RuntimeDoubleHistory {
    const store = createHistoryStore(resetRuntimeState);

    return createRuntimeHistory(store, createHistoryApi(store));
}

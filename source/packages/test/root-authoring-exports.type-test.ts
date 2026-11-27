import type { IsEqual } from 'type-fest';
import { suite as typeSuite, test as typeTest } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type {
    TestFamilyId as EngineTestFamily
} from '../engine/engine.entry-point.ts';
import type {
    doubleUsage as leafDoubleUsage,
    rule as leafRule,
    testAsyncDisposable as leafTestAsyncDisposable,
    testAsyncIterable as leafTestAsyncIterable,
    testAsyncIterator as leafTestAsyncIterator,
    testDisposable as leafTestDisposable,
    testDouble as leafTestDouble,
    testIterable as leafTestIterable,
    testIterator as leafTestIterator,
    AsyncDisposableConfiguration as LeafAsyncDisposableConfiguration,
    AsyncIterableConfiguration as LeafAsyncIterableConfiguration,
    AsyncIteratorConfiguration as LeafAsyncIteratorConfiguration,
    AsyncIteratorSource as LeafAsyncIteratorSource,
    DisposableConfiguration as LeafDisposableConfiguration,
    DoubleCall as LeafDoubleCall,
    DoubleConstruction as LeafDoubleConstruction,
    DoubleHistory as LeafDoubleHistory,
    DoubleInteraction as LeafDoubleInteraction,
    DoubleInvocation as LeafDoubleInvocation,
    DoubleIteratorEvent as LeafDoubleIteratorEvent,
    DoubleIteratorReturnEvent as LeafDoubleIteratorReturnEvent,
    DoubleIteratorThrowEvent as LeafDoubleIteratorThrowEvent,
    DoubleIteratorYieldEvent as LeafDoubleIteratorYieldEvent,
    DoubleResult as LeafDoubleResult,
    DoubleReturnedResult as LeafDoubleReturnedResult,
    DoubleThrownResult as LeafDoubleThrownResult,
    DoubleUsageAssertions as LeafDoubleUsageAssertions,
    ProtocolMethodConfiguration as LeafProtocolMethodConfiguration,
    RuleFactory as LeafRuleFactory,
    SyncIterableConfiguration as LeafSyncIterableConfiguration,
    SyncIteratorConfiguration as LeafSyncIteratorConfiguration,
    SyncIteratorSource as LeafSyncIteratorSource,
    TestAsyncDisposable as LeafTestAsyncDisposable,
    TestAsyncDisposableFactory as LeafTestAsyncDisposableFactory,
    TestAsyncIterable as LeafTestAsyncIterable,
    TestAsyncIterableFactory as LeafTestAsyncIterableFactory,
    TestAsyncIterator as LeafTestAsyncIterator,
    TestAsyncIteratorFactory as LeafTestAsyncIteratorFactory,
    TestDisposable as LeafTestDisposable,
    TestDisposableFactory as LeafTestDisposableFactory,
    TestDouble as LeafTestDouble,
    TestDoubleFactory as LeafTestDoubleFactory,
    TestIterable as LeafTestIterable,
    TestIterableFactory as LeafTestIterableFactory,
    TestIterator as LeafTestIterator,
    TestIteratorFactory as LeafTestIteratorFactory
} from '../doubles/doubles.entry-point.ts';
import type {
    createTestFacade,
    createTranscript,
    defineHarness,
    defineMacro,
    defineParameterizedTestBody,
    doubleUsage,
    recordAsyncSink,
    recordSink,
    AsyncDisposableConfiguration as RootAsyncDisposableConfiguration,
    AsyncIterableConfiguration as RootAsyncIterableConfiguration,
    AsyncIteratorConfiguration as RootAsyncIteratorConfiguration,
    AsyncIteratorSource as RootAsyncIteratorSource,
    DisposableConfiguration as RootDisposableConfiguration,
    DoubleCall as RootDoubleCall,
    DoubleConstruction as RootDoubleConstruction,
    DoubleHistory as RootDoubleHistory,
    DoubleInteraction as RootDoubleInteraction,
    DoubleInvocation as RootDoubleInvocation,
    DoubleIteratorEvent as RootDoubleIteratorEvent,
    DoubleIteratorReturnEvent as RootDoubleIteratorReturnEvent,
    DoubleIteratorThrowEvent as RootDoubleIteratorThrowEvent,
    DoubleIteratorYieldEvent as RootDoubleIteratorYieldEvent,
    DoubleResult as RootDoubleResult,
    DoubleReturnedResult as RootDoubleReturnedResult,
    DoubleThrownResult as RootDoubleThrownResult,
    DoubleUsageAssertions as RootDoubleUsageAssertions,
    ProtocolMethodConfiguration as RootProtocolMethodConfiguration,
    rule,
    RuleFactory as RootRuleFactory,
    runIfMain,
    RunIfMain,
    SyncIterableConfiguration as RootSyncIterableConfiguration,
    SyncIteratorConfiguration as RootSyncIteratorConfiguration,
    SyncIteratorSource as RootSyncIteratorSource,
    skippedTest,
    table,
    testAsyncDisposable,
    TestAsyncDisposable as RootTestAsyncDisposable,
    TestAsyncDisposableFactory as RootTestAsyncDisposableFactory,
    testAsyncIterable,
    TestAsyncIterable as RootTestAsyncIterable,
    TestAsyncIterableFactory as RootTestAsyncIterableFactory,
    testAsyncIterator,
    TestAsyncIterator as RootTestAsyncIterator,
    TestAsyncIteratorFactory as RootTestAsyncIteratorFactory,
    testDisposable,
    TestDisposable as RootTestDisposable,
    TestDisposableFactory as RootTestDisposableFactory,
    testDouble,
    TestDouble as RootTestDouble,
    TestDoubleFactory as RootTestDoubleFactory,
    TestFamilyId,
    testIterable,
    TestIterable as RootTestIterable,
    TestIterableFactory as RootTestIterableFactory,
    testIterator,
    TestIterator as RootTestIterator,
    TestIteratorFactory as RootTestIteratorFactory,
    transcriptUsage,
    suite,
    test
} from './test.entry-point.ts';

type RootRuntimeExport = keyof {
    readonly createTestFacade: typeof createTestFacade;
    readonly createTranscript: typeof createTranscript;
    readonly defineHarness: typeof defineHarness;
    readonly defineMacro: typeof defineMacro;
    readonly defineParameterizedTestBody: typeof defineParameterizedTestBody;
    readonly doubleUsage: typeof doubleUsage;
    readonly recordAsyncSink: typeof recordAsyncSink;
    readonly recordSink: typeof recordSink;
    readonly rule: typeof rule;
    readonly runIfMain: typeof runIfMain;
    readonly skippedTest: typeof skippedTest;
    readonly suite: typeof suite;
    readonly table: typeof table;
    readonly test: typeof test;
    readonly testAsyncDisposable: typeof testAsyncDisposable;
    readonly testAsyncIterable: typeof testAsyncIterable;
    readonly testAsyncIterator: typeof testAsyncIterator;
    readonly testDisposable: typeof testDisposable;
    readonly testDouble: typeof testDouble;
    readonly testIterable: typeof testIterable;
    readonly testIterator: typeof testIterator;
    readonly transcriptUsage: typeof transcriptUsage;
};
type RootDoublesTypes = {
    readonly asyncDisposableConfiguration: RootAsyncDisposableConfiguration;
    readonly asyncIterableConfiguration: RootAsyncIterableConfiguration<string, number, boolean>;
    readonly asyncIteratorConfiguration: RootAsyncIteratorConfiguration<string, number>;
    readonly asyncIteratorSource: RootAsyncIteratorSource<string, number>;
    readonly disposableConfiguration: RootDisposableConfiguration;
    readonly doubleCall: RootDoubleCall<readonly [string], number, boolean>;
    readonly doubleConstruction: RootDoubleConstruction<readonly [string], { readonly id: string; }>;
    readonly doubleHistory: RootDoubleHistory<() => string>;
    readonly doubleInteraction: RootDoubleInteraction;
    readonly doubleInvocation: RootDoubleInvocation<readonly [string]>;
    readonly doubleIteratorEvent: RootDoubleIteratorEvent;
    readonly doubleIteratorReturnEvent: RootDoubleIteratorReturnEvent;
    readonly doubleIteratorThrowEvent: RootDoubleIteratorThrowEvent;
    readonly doubleIteratorYieldEvent: RootDoubleIteratorYieldEvent;
    readonly doubleResult: RootDoubleResult<string>;
    readonly doubleReturnedResult: RootDoubleReturnedResult<string>;
    readonly doubleThrownResult: RootDoubleThrownResult;
    readonly doubleUsageAssertions: RootDoubleUsageAssertions;
    readonly protocolMethodConfiguration: RootProtocolMethodConfiguration<() => string>;
    readonly ruleFactory: RootRuleFactory;
    readonly syncIterableConfiguration: RootSyncIterableConfiguration<string, number, boolean>;
    readonly syncIteratorConfiguration: RootSyncIteratorConfiguration<string, number>;
    readonly syncIteratorSource: RootSyncIteratorSource<string, number>;
    readonly testAsyncDisposable: RootTestAsyncDisposable;
    readonly testAsyncDisposableFactory: RootTestAsyncDisposableFactory;
    readonly testAsyncIterable: RootTestAsyncIterable<string, number, boolean>;
    readonly testAsyncIterableFactory: RootTestAsyncIterableFactory;
    readonly testAsyncIterator: RootTestAsyncIterator<string, number, boolean>;
    readonly testAsyncIteratorFactory: RootTestAsyncIteratorFactory;
    readonly testDisposable: RootTestDisposable;
    readonly testDisposableFactory: RootTestDisposableFactory;
    readonly testDouble: RootTestDouble<() => string>;
    readonly testDoubleFactory: RootTestDoubleFactory;
    readonly testIterable: RootTestIterable<string, number, boolean>;
    readonly testIterableFactory: RootTestIterableFactory;
    readonly testIterator: RootTestIterator<string, number, boolean>;
    readonly testIteratorFactory: RootTestIteratorFactory;
};
type LeafDoublesTypes = {
    readonly asyncDisposableConfiguration: LeafAsyncDisposableConfiguration;
    readonly asyncIterableConfiguration: LeafAsyncIterableConfiguration<string, number, boolean>;
    readonly asyncIteratorConfiguration: LeafAsyncIteratorConfiguration<string, number>;
    readonly asyncIteratorSource: LeafAsyncIteratorSource<string, number>;
    readonly disposableConfiguration: LeafDisposableConfiguration;
    readonly doubleCall: LeafDoubleCall<readonly [string], number, boolean>;
    readonly doubleConstruction: LeafDoubleConstruction<readonly [string], { readonly id: string; }>;
    readonly doubleHistory: LeafDoubleHistory<() => string>;
    readonly doubleInteraction: LeafDoubleInteraction;
    readonly doubleInvocation: LeafDoubleInvocation<readonly [string]>;
    readonly doubleIteratorEvent: LeafDoubleIteratorEvent;
    readonly doubleIteratorReturnEvent: LeafDoubleIteratorReturnEvent;
    readonly doubleIteratorThrowEvent: LeafDoubleIteratorThrowEvent;
    readonly doubleIteratorYieldEvent: LeafDoubleIteratorYieldEvent;
    readonly doubleResult: LeafDoubleResult<string>;
    readonly doubleReturnedResult: LeafDoubleReturnedResult<string>;
    readonly doubleThrownResult: LeafDoubleThrownResult;
    readonly doubleUsageAssertions: LeafDoubleUsageAssertions;
    readonly protocolMethodConfiguration: LeafProtocolMethodConfiguration<() => string>;
    readonly ruleFactory: LeafRuleFactory;
    readonly syncIterableConfiguration: LeafSyncIterableConfiguration<string, number, boolean>;
    readonly syncIteratorConfiguration: LeafSyncIteratorConfiguration<string, number>;
    readonly syncIteratorSource: LeafSyncIteratorSource<string, number>;
    readonly testAsyncDisposable: LeafTestAsyncDisposable;
    readonly testAsyncDisposableFactory: LeafTestAsyncDisposableFactory;
    readonly testAsyncIterable: LeafTestAsyncIterable<string, number, boolean>;
    readonly testAsyncIterableFactory: LeafTestAsyncIterableFactory;
    readonly testAsyncIterator: LeafTestAsyncIterator<string, number, boolean>;
    readonly testAsyncIteratorFactory: LeafTestAsyncIteratorFactory;
    readonly testDisposable: LeafTestDisposable;
    readonly testDisposableFactory: LeafTestDisposableFactory;
    readonly testDouble: LeafTestDouble<() => string>;
    readonly testDoubleFactory: LeafTestDoubleFactory;
    readonly testIterable: LeafTestIterable<string, number, boolean>;
    readonly testIterableFactory: LeafTestIterableFactory;
    readonly testIterator: LeafTestIterator<string, number, boolean>;
    readonly testIteratorFactory: LeafTestIteratorFactory;
};

declare const createTestFacadeUnderTest: typeof createTestFacade;

export const testNode = typeSuite('@overkill-dev/test', [
    typeTest('exposes root authoring names', function (typeScope) {
        typeScope.assert(sameType<
            RootRuntimeExport,
            keyof {
                readonly createTestFacade: true;
                readonly createTranscript: true;
                readonly defineHarness: true;
                readonly defineMacro: true;
                readonly defineParameterizedTestBody: true;
                readonly doubleUsage: true;
                readonly recordAsyncSink: true;
                readonly recordSink: true;
                readonly rule: true;
                readonly runIfMain: true;
                readonly skippedTest: true;
                readonly suite: true;
                readonly table: true;
                readonly test: true;
                readonly testAsyncDisposable: true;
                readonly testAsyncIterable: true;
                readonly testAsyncIterator: true;
                readonly testDisposable: true;
                readonly testDouble: true;
                readonly testIterable: true;
                readonly testIterator: true;
                readonly transcriptUsage: true;
            }
        >());
        typeScope.assert(acceptsCall, () => createTestFacadeUnderTest());
        typeScope.assert(acceptsCall, () => createTestFacadeUnderTest({}));
        typeScope.assert(sameType<IsEqual<typeof runIfMain, RunIfMain>, true>());
        typeScope.assert(sameType<IsEqual<TestFamilyId, EngineTestFamily>, true>());
        return typeScope.assert.collect();
    }),
    typeTest('re-exports doubles values from the root facade', function (typeScope) {
        typeScope.assert(sameType<IsEqual<typeof doubleUsage, typeof leafDoubleUsage>, true>());
        typeScope.assert(sameType<IsEqual<typeof rule, typeof leafRule>, true>());
        typeScope.assert(sameType<IsEqual<typeof testAsyncDisposable, typeof leafTestAsyncDisposable>, true>());
        typeScope.assert(sameType<IsEqual<typeof testAsyncIterable, typeof leafTestAsyncIterable>, true>());
        typeScope.assert(sameType<IsEqual<typeof testAsyncIterator, typeof leafTestAsyncIterator>, true>());
        typeScope.assert(sameType<IsEqual<typeof testDisposable, typeof leafTestDisposable>, true>());
        typeScope.assert(sameType<IsEqual<typeof testDouble, typeof leafTestDouble>, true>());
        typeScope.assert(sameType<IsEqual<typeof testIterable, typeof leafTestIterable>, true>());
        typeScope.assert(sameType<IsEqual<typeof testIterator, typeof leafTestIterator>, true>());
        return typeScope.assert.collect();
    }),
    typeTest('re-exports doubles types from the root facade', function (typeScope) {
        typeScope.assert(sameType<IsEqual<RootDoublesTypes, LeafDoublesTypes>, true>());
        return typeScope.assert.collect();
    })
]);

import type { IsEqual } from 'type-fest';
import { acceptsCall, sameType } from '../type-test/type-test.entry-point.ts';
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
import {
    type createTestFacade,
    type createTranscript,
    type defineHarness,
    type defineMacro,
    type defineParameterizedTestBody,
    type doubleUsage,
    type recordAsyncSink,
    type recordSink,
    type AsyncDisposableConfiguration as RootAsyncDisposableConfiguration,
    type AsyncIterableConfiguration as RootAsyncIterableConfiguration,
    type AsyncIteratorConfiguration as RootAsyncIteratorConfiguration,
    type AsyncIteratorSource as RootAsyncIteratorSource,
    type DisposableConfiguration as RootDisposableConfiguration,
    type DoubleCall as RootDoubleCall,
    type DoubleConstruction as RootDoubleConstruction,
    type DoubleHistory as RootDoubleHistory,
    type DoubleInteraction as RootDoubleInteraction,
    type DoubleInvocation as RootDoubleInvocation,
    type DoubleIteratorEvent as RootDoubleIteratorEvent,
    type DoubleIteratorReturnEvent as RootDoubleIteratorReturnEvent,
    type DoubleIteratorThrowEvent as RootDoubleIteratorThrowEvent,
    type DoubleIteratorYieldEvent as RootDoubleIteratorYieldEvent,
    type DoubleResult as RootDoubleResult,
    type DoubleReturnedResult as RootDoubleReturnedResult,
    type DoubleThrownResult as RootDoubleThrownResult,
    type DoubleUsageAssertions as RootDoubleUsageAssertions,
    type ProtocolMethodConfiguration as RootProtocolMethodConfiguration,
    type rule,
    type RuleFactory as RootRuleFactory,
    type runIfMain,
    type RunIfMain,
    type SyncIterableConfiguration as RootSyncIterableConfiguration,
    type SyncIteratorConfiguration as RootSyncIteratorConfiguration,
    type SyncIteratorSource as RootSyncIteratorSource,
    type skippedTest,
    type table,
    type testAsyncDisposable,
    type TestAsyncDisposable as RootTestAsyncDisposable,
    type TestAsyncDisposableFactory as RootTestAsyncDisposableFactory,
    type testAsyncIterable,
    type TestAsyncIterable as RootTestAsyncIterable,
    type TestAsyncIterableFactory as RootTestAsyncIterableFactory,
    type testAsyncIterator,
    type TestAsyncIterator as RootTestAsyncIterator,
    type TestAsyncIteratorFactory as RootTestAsyncIteratorFactory,
    type testDisposable,
    type TestDisposable as RootTestDisposable,
    type TestDisposableFactory as RootTestDisposableFactory,
    type testDouble,
    type TestDouble as RootTestDouble,
    type TestDoubleFactory as RootTestDoubleFactory,
    type TestFamilyId,
    type testIterable,
    type TestIterable as RootTestIterable,
    type TestIterableFactory as RootTestIterableFactory,
    type testIterator,
    type TestIterator as RootTestIterator,
    type TestIteratorFactory as RootTestIteratorFactory,
    type transcriptUsage,
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

export const testNode = suite('Root test authoring exports', [
    test('exposes root authoring names', function (scope) {
        scope.assert(sameType<
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
        scope.assert(acceptsCall, function () {
            return createTestFacadeUnderTest();
        });
        scope.assert(acceptsCall, function () {
            return createTestFacadeUnderTest({});
        });
        scope.assert(sameType<IsEqual<typeof runIfMain, RunIfMain>, true>());
        scope.assert(sameType<IsEqual<TestFamilyId, EngineTestFamily>, true>());
        return scope.assert.collect();
    }),
    test('re-exports doubles values from the root facade', function (scope) {
        scope.assert(sameType<IsEqual<typeof doubleUsage, typeof leafDoubleUsage>, true>());
        scope.assert(sameType<IsEqual<typeof rule, typeof leafRule>, true>());
        scope.assert(sameType<IsEqual<typeof testAsyncDisposable, typeof leafTestAsyncDisposable>, true>());
        scope.assert(sameType<IsEqual<typeof testAsyncIterable, typeof leafTestAsyncIterable>, true>());
        scope.assert(sameType<IsEqual<typeof testAsyncIterator, typeof leafTestAsyncIterator>, true>());
        scope.assert(sameType<IsEqual<typeof testDisposable, typeof leafTestDisposable>, true>());
        scope.assert(sameType<IsEqual<typeof testDouble, typeof leafTestDouble>, true>());
        scope.assert(sameType<IsEqual<typeof testIterable, typeof leafTestIterable>, true>());
        scope.assert(sameType<IsEqual<typeof testIterator, typeof leafTestIterator>, true>());
        return scope.assert.collect();
    }),
    test('re-exports doubles types from the root facade', function (scope) {
        scope.assert(sameType<IsEqual<RootDoublesTypes, LeafDoublesTypes>, true>());
        return scope.assert.collect();
    })
]);

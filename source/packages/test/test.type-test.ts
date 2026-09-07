import { describe, expect, test as typeTest } from 'tstyche';
import type {
    DefinedOutputRenderer,
    DefinedReporter,
    Metadata,
    Suite,
    Table,
    TestBody,
    TestCase,
    TestNode,
    TestScope,
    TestScopeAssertContext
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
    defineMacro,
    defineParameterizedTestBody,
    type doubleUsage,
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
    type Metadata as RootMetadata,
    type ParameterizedTestScope,
    type ProtocolMethodConfiguration as RootProtocolMethodConfiguration,
    type rule,
    type RuleFactory as RootRuleFactory,
    runIfMain,
    type RunIfMain,
    type RunIfMainOptions as RootRunIfMainOptions,
    type RunIfMainRootOptions as RootRunIfMainRootOptions,
    type SyncIterableConfiguration as RootSyncIterableConfiguration,
    type SyncIteratorConfiguration as RootSyncIteratorConfiguration,
    type SyncIteratorSource as RootSyncIteratorSource,
    type Suite as RootSuite,
    table,
    type Table as RootTable,
    type TableDefinition,
    type TableTestBody,
    type testAsyncDisposable,
    type TestAsyncDisposable as RootTestAsyncDisposable,
    type TestAsyncDisposableFactory as RootTestAsyncDisposableFactory,
    type testAsyncIterable,
    type TestAsyncIterable as RootTestAsyncIterable,
    type TestAsyncIterableFactory as RootTestAsyncIterableFactory,
    type testAsyncIterator,
    type TestAsyncIterator as RootTestAsyncIterator,
    type TestAsyncIteratorFactory as RootTestAsyncIteratorFactory,
    type TestBody as RootTestBody,
    type TestCase as RootTestCase,
    type testDisposable,
    type TestDisposable as RootTestDisposable,
    type TestDisposableFactory as RootTestDisposableFactory,
    type testDouble,
    type TestDouble as RootTestDouble,
    type TestDoubleFactory as RootTestDoubleFactory,
    type testIterable,
    type TestIterable as RootTestIterable,
    type TestIterableFactory as RootTestIterableFactory,
    type testIterator,
    type TestIterator as RootTestIterator,
    type TestIteratorFactory as RootTestIteratorFactory,
    type TestNode as RootTestNode,
    type TestScope as RootTestScope,
    type TestScopeAssertContext as RootTestScopeAssertContext,
    suite,
    test
} from './test.entry-point.ts';

type UnavailableAuthoringApi = (...parameters: readonly unknown[]) => never;
declare const body: TestBody;
declare const metadata: Metadata;
declare const node: TestNode;
declare const tableBody: TableTestBody<{ readonly value: number; }>;
declare const outputRenderer: DefinedOutputRenderer;
declare const reporter: DefinedReporter;
type RootRuntimeExport = keyof {
    readonly createTestFacade: typeof createTestFacade;
    readonly defineMacro: typeof defineMacro;
    readonly defineParameterizedTestBody: typeof defineParameterizedTestBody;
    readonly doubleUsage: typeof doubleUsage;
    readonly rule: typeof rule;
    readonly runIfMain: typeof runIfMain;
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

describe('@overkill-dev/test', function () {
    typeTest('exposes root authoring names', function () {
        expect<RootRuntimeExport>().type.toBe<
            keyof {
                readonly createTestFacade: true;
                readonly defineMacro: true;
                readonly defineParameterizedTestBody: true;
                readonly doubleUsage: true;
                readonly rule: true;
                readonly runIfMain: true;
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
            }
        >();
        expect<typeof createTestFacade>().type.toBe<UnavailableAuthoringApi>();
        expect<typeof runIfMain>().type.toBe<RunIfMain>();
    });

    typeTest('re-exports doubles values from the root facade', function () {
        expect<typeof doubleUsage>().type.toBe<typeof leafDoubleUsage>();
        expect<typeof rule>().type.toBe<typeof leafRule>();
        expect<typeof testAsyncDisposable>().type.toBe<typeof leafTestAsyncDisposable>();
        expect<typeof testAsyncIterable>().type.toBe<typeof leafTestAsyncIterable>();
        expect<typeof testAsyncIterator>().type.toBe<typeof leafTestAsyncIterator>();
        expect<typeof testDisposable>().type.toBe<typeof leafTestDisposable>();
        expect<typeof testDouble>().type.toBe<typeof leafTestDouble>();
        expect<typeof testIterable>().type.toBe<typeof leafTestIterable>();
        expect<typeof testIterator>().type.toBe<typeof leafTestIterator>();
    });

    typeTest('re-exports doubles types from the root facade', function () {
        expect<RootDoublesTypes>().type.toBe<LeafDoublesTypes>();
    });

    typeTest('defines reusable source-aware macros and parameterized bodies', function () {
        const macro = defineMacro(function reusableCase(title: string, value: number) {
            expect(title).type.toBe<string>();
            expect(value).type.toBe<number>();

            return test(title, body);
        });
        const parameterizedBody = defineParameterizedTestBody<{ readonly value: number; }>(function bodyForData(
            scope,
            data
        ) {
            expect(scope).type.toBe<TestScope>();
            expect(data.value).type.toBe<number>();

            return scope.assert.collect();
        });

        expect(macro('value case', 1)).type.toBe<TestCase>();
        expect(parameterizedBody({ value: 1 })).type.toBe<TestBody>();
    });

    typeTest('creates test, suite, and table nodes from default root authoring forms', function () {
        expect(test('passes', body)).type.toBe<TestCase>();
        expect(test({ body, metadata, title: 'passes' })).type.toBe<TestCase>();
        expect(suite('group', [ node ])).type.toBe<Suite>();
        expect(suite({ children: [ node ], metadata, title: 'group' })).type.toBe<Suite>();
        expect(table({
            cases: [ { value: 1 } ],
            caseTitle(parameters, index) {
                expect(parameters.value).type.toBe<number>();
                expect(index).type.toBe<number>();

                return String(parameters.value);
            },
            metadata,
            test: tableBody,
            title: 'rows'
        }))
            .type
            .toBe<Table>();
        expect<TableDefinition<{ readonly value: number; }>>().type.toBeAssignableFrom<{
            readonly cases: readonly [{ readonly value: number; }, { readonly value: number; }];
            readonly test: TableTestBody<{ readonly value: number; }>;
            readonly title: string;
        }>();
        expect<ParameterizedTestScope<{ readonly value: number; }>>().type.toBeAssignableTo<TestScope>();
    });

    typeTest('rejects unstaged root authoring forms', function () {
        expect(test).type.not.toBeCallableWith('passes', metadata, body);
        expect(test).type.not.toBeCallableWith({ body, name: 'passes' });
        expect(suite).type.not.toBeCallableWith('group', metadata, [ node ]);
        expect(suite).type.not.toBeCallableWith({ children: [ node ], name: 'group' });
        expect(suite).type.not.toBeCallableWith('group', [ { kind: 'test', metadata: {}, title: 'plain' } ]);
        expect(table).type.not.toBeCallableWith({ cases: [ { value: 1 } ], name: 'rows', test: tableBody });
    });

    typeTest('re-exports high-level authoring types from the engine', function () {
        expect<RootMetadata>().type.toBe<Metadata>();
        expect<RootRunIfMainOptions>().type.toBe<{
            readonly outputRenderer?: DefinedOutputRenderer;
            readonly reporters?: readonly DefinedReporter[];
            readonly root?: RootRunIfMainRootOptions;
        }>();
        expect<RootRunIfMainRootOptions>().type.toBe<{
            readonly metadata: Metadata;
            readonly title: string;
        }>();
        expect<RootSuite>().type.toBe<Suite>();
        expect<RootTable>().type.toBe<Table>();
        expect<RootTestBody>().type.toBe<TestBody>();
        expect<RootTestCase>().type.toBe<TestCase>();
        expect<RootTestNode>().type.toBe<TestNode>();
        expect<RootTestScope>().type.toBe<TestScope>();
        expect<RootTestScopeAssertContext>().type.toBe<TestScopeAssertContext>();
    });

    typeTest('runs direct entrypoints with runner-owned options', function () {
        expect(runIfMain).type.toBeCallableWith(import.meta, node);
        expect(runIfMain).type.toBeCallableWith(import.meta, node, {
            outputRenderer,
            reporters: [ reporter ],
            root: {
                metadata,
                title: 'root'
            }
        });
        expect(runIfMain).type.not.toBeCallableWith(import.meta, node, { runFacts: {} });
        expect(runIfMain).type.not.toBeCallableWith(import.meta, node, { profile: 'microtest' });
        expect(runIfMain).type.not.toBeCallableWith(import.meta, node, { cwd: 'project' });
    });
});

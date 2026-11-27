import type { IsEqual } from 'type-fest';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { suite as typeSuite, test as typeTest } from '@overkill-dev/test';
import { acceptsCall, assignableFrom, assignableTo, rejectsCall, sameType } from '@overkill-dev/type-test';
import type {
    Suite,
    Table,
    TestAnnotationsInput,
    TestBody,
    TestCase,
    TestControlsInput,
    TestFamilyId as EngineTestFamily,
    TestNode,
    TestScope
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
    type AuthoringAnnotations,
    type AuthoringControls,
    createTestFacade,
    type createTranscript,
    type defineHarness,
    defineMacro,
    defineParameterizedTestBody,
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
    type ParameterizedTestScope,
    type ProtocolMethodConfiguration as RootProtocolMethodConfiguration,
    type rule,
    type RuleFactory as RootRuleFactory,
    runIfMain,
    type RunIfMain,
    type SyncIterableConfiguration as RootSyncIterableConfiguration,
    type SyncIteratorConfiguration as RootSyncIteratorConfiguration,
    type SyncIteratorSource as RootSyncIteratorSource,
    skippedTest,
    table,
    type TableDefinition,
    type TableTestBody,
    type TestFacade,
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

declare const body: TestBody;
declare const annotations: AuthoringAnnotations;
declare const authoringControls: AuthoringControls;
declare const engineControls: TestControlsInput;
declare const dynamicScopeMap: Readonly<Record<string, unknown>>;
declare const node: TestNode;
declare const tableBody: TableTestBody<{ readonly value: number; }>;
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

export const testNode = typeSuite('test', [
    typeSuite('@overkill-dev/test', [
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
            typeScope.assert(sameType<TestFamilyId, EngineTestFamily>());
            return typeScope.assert.collect();
        }),
        typeTest('re-exports doubles values from the root facade', function (typeScope) {
            typeScope.assert(sameType<typeof doubleUsage, typeof leafDoubleUsage>());
            typeScope.assert(sameType<typeof rule, typeof leafRule>());
            typeScope.assert(sameType<typeof testAsyncDisposable, typeof leafTestAsyncDisposable>());
            typeScope.assert(sameType<typeof testAsyncIterable, typeof leafTestAsyncIterable>());
            typeScope.assert(sameType<typeof testAsyncIterator, typeof leafTestAsyncIterator>());
            typeScope.assert(sameType<typeof testDisposable, typeof leafTestDisposable>());
            typeScope.assert(sameType<typeof testDouble, typeof leafTestDouble>());
            typeScope.assert(sameType<typeof testIterable, typeof leafTestIterable>());
            typeScope.assert(sameType<typeof testIterator, typeof leafTestIterator>());
            return typeScope.assert.collect();
        }),
        typeTest('re-exports doubles types from the root facade', function (typeScope) {
            typeScope.assert(sameType<IsEqual<RootDoublesTypes, LeafDoublesTypes>, true>());
            return typeScope.assert.collect();
        })
    ]),
    typeSuite('@overkill-dev/test authoring', [
        typeTest('defines reusable source-aware macros and parameterized bodies', function (typeScope) {
            const macro = defineMacro(function reusableCase(title: string, value: number) {
                typeScope.assert(sameType.withActual<string>(), title);
                typeScope.assert(sameType.withActual<number>(), value);

                return test(title, body);
            });
            const parameterizedBody = defineParameterizedTestBody<{ readonly value: number; }>(function bodyForData(
                scope,
                data
            ) {
                typeScope.assert(sameType<IsEqual<typeof scope, TestScope>, true>());
                typeScope.assert(sameType.withActual<number>(), data.value);

                return scope.assert.collect();
            });

            typeScope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(macro('value case', 1)));
            typeScope.assert(sameType.withActual<true>(), isEqualTo<TestBody>()(parameterizedBody({ value: 1 })));
            return typeScope.assert.collect();
        }),
        typeTest('creates neutral test facade nodes', function (typeScope) {
            const facade = createTestFacade({
                controls: authoringControls
            });

            typeScope.assert(sameType<IsEqual<typeof facade, TestFacade>, true>());
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<TestCase>()(facade.skippedTest('skips', 'unsupported platform'))
            );
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<TestCase>()(facade.skippedTest({
                    controls: { capture: 'live' },
                    reason: 'unsupported platform',
                    title: 'skips'
                }))
            );
            typeScope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(facade.test('passes', body)));
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<TestCase>()(facade.test({ body, controls: { capture: 'live' }, title: 'passes' }))
            );
            typeScope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(facade.suite('group', [ node ])));
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<Suite>()(
                    facade.suite({ children: [ node ], controls: { capture: 'buffered' }, title: 'group' })
                )
            );
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<Table>()(facade.table({
                    cases: [ { value: 1 } ],
                    controls: { capture: 'live' },
                    test: tableBody,
                    title: 'rows'
                }))
            );
            return typeScope.assert.collect();
        }),
        typeTest('creates neutral facade macro forms', function (typeScope) {
            const facade = createTestFacade({
                annotations
            });
            const macro = facade.defineMacro(function reusableCase(title: string) {
                return facade.test(title, body);
            });
            const parameterizedBody = facade.defineParameterizedTestBody<{ readonly value: number; }>(
                function bodyForData(
                    scope,
                    data
                ) {
                    typeScope.assert(sameType<IsEqual<typeof scope, TestScope>, true>());
                    typeScope.assert(sameType.withActual<number>(), data.value);

                    return scope.assert.collect();
                }
            );

            typeScope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(macro('value case')));
            typeScope.assert(sameType.withActual<true>(), isEqualTo<TestBody>()(parameterizedBody({ value: 1 })));
            return typeScope.assert.collect();
        }),
        typeTest('keeps neutral facades narrow', function (typeScope) {
            const facade = createTestFacade({
                annotations
            });

            typeScope.assert(assignableFrom.not<keyof typeof facade, 'doubleUsage'>());
            typeScope.assert(assignableFrom.not<keyof typeof facade, 'testDouble'>());
            typeScope.assert(assignableFrom.not<keyof typeof facade, 'defineHarness'>());
            typeScope.assert(assignableFrom.not<keyof typeof facade, 'defineCompositeAssertion'>());
            return typeScope.assert.collect();
        }),
        typeTest('guards facade scope mapping against core scope keys', function (typeScope) {
            const assertScopeOptions = {
                mapScope(scope: TestScope) {
                    return { assert: scope.assert };
                }
            };
            typeScope.assert(rejectsCall('no-matching-overload'), () => createTestFacade(assertScopeOptions));
            const collectScopeOptions = {
                mapScope() {
                    return { collect: true };
                }
            };
            typeScope.assert(rejectsCall('no-matching-overload'), () => createTestFacade(collectScopeOptions));
            const parametersScopeOptions = {
                mapScope() {
                    return { parameters: { value: 1 } };
                }
            };
            typeScope.assert(rejectsCall('no-matching-overload'), () => createTestFacade(parametersScopeOptions));
            const resourcesScopeOptions = {
                mapScope() {
                    return { resources: {} };
                }
            };
            typeScope.assert(rejectsCall('no-matching-overload'), () => createTestFacade(resourcesScopeOptions));
            const runtimesScopeOptions = {
                mapScope() {
                    return { runtimes: {} };
                }
            };
            typeScope.assert(rejectsCall('no-matching-overload'), () => createTestFacade(runtimesScopeOptions));
            typeScope.assert(acceptsCall, () =>
                createTestFacadeUnderTest({
                    mapScope() {
                        return dynamicScopeMap;
                    }
                }));
            return typeScope.assert.collect();
        }),
        typeTest('creates test, suite, and table nodes from default root authoring forms', function (typeScope) {
            typeScope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(test('passes', body)));
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<TestCase>()(test({ annotations, body, controls: authoringControls, title: 'passes' }))
            );
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<TestCase>()(skippedTest('skips', 'unsupported platform'))
            );
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<TestCase>()(skippedTest({
                    annotations,
                    controls: authoringControls,
                    reason: 'unsupported platform',
                    title: 'skips'
                }))
            );
            typeScope.assert(sameType.withActual<true>(), isEqualTo<Suite>()(suite('group', [ node ])));
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<Suite>()(
                    suite({ annotations, children: [ node ], controls: authoringControls, title: 'group' })
                )
            );
            const authoredTable = table({
                annotations,
                cases: [ { value: 1 } ],
                caseTitle(parameters, index) {
                    typeScope.assert(sameType.withActual<number>(), parameters.value);
                    typeScope.assert(sameType.withActual<number>(), index);

                    return String(parameters.value);
                },
                controls: authoringControls,
                test: tableBody,
                title: 'rows'
            });
            typeScope.assert(sameType<IsEqual<typeof authoredTable, Table>, true>());
            typeScope.assert(sameType<
                [{
                    readonly cases: readonly [{ readonly value: number; }, { readonly value: number; }];
                    readonly test: TableTestBody<{ readonly value: number; }>;
                    readonly title: string;
                }] extends [TableDefinition<{ readonly value: number; }>] ? true : false,
                true
            >());
            typeScope.assert(
                sameType<
                    [ParameterizedTestScope<{ readonly value: number; }>] extends [TestScope] ? true : false,
                    true
                >()
            );
            return typeScope.assert.collect();
        }),
        typeTest('rejects unstaged root authoring forms', function (typeScope) {
            typeScope.assert(rejectsCall('argument-count'), () => test('passes', annotations, body));
            typeScope.assert(rejectsCall('argument-type'), () => test({ body, name: 'passes' }));
            typeScope.assert(
                rejectsCall('argument-count'),
                () => skippedTest('skips', annotations, 'unsupported platform')
            );
            typeScope.assert(
                rejectsCall('argument-type'),
                () => skippedTest({ name: 'skips', reason: 'unsupported platform' })
            );
            typeScope.assert(rejectsCall('argument-count'), () => suite('group', annotations, [ node ]));
            typeScope.assert(rejectsCall('argument-type'), () => suite({ children: [ node ], name: 'group' }));
            typeScope.assert(rejectsCall('argument-type'), () =>
                suite('group', [ {
                    annotations: {},
                    controls: {},
                    kind: 'test',
                    title: 'plain'
                } ]));
            typeScope.assert(
                rejectsCall('argument-type'),
                () => table({ cases: [ { value: 1 } ], name: 'rows', test: tableBody })
            );
            return typeScope.assert.collect();
        }),
        typeTest('defines narrow high-level authoring test data', function (typeScope) {
            typeScope.assert(sameType<AuthoringAnnotations, {
                readonly ownership?: readonly string[];
                readonly tags?: readonly string[];
            }>());
            typeScope.assert(assignableTo<AuthoringAnnotations, TestAnnotationsInput>());
            typeScope.assert(sameType<AuthoringControls, {
                readonly capture?: 'buffered' | 'live';
                readonly duplicateExecution?: 'forbidden' | 'idempotent';
                readonly timeoutMilliseconds?: number;
            }>());
            typeScope.assert(assignableTo<AuthoringControls, TestControlsInput>());
            return typeScope.assert.collect();
        }),
        typeTest('rejects removed high-level authoring metadata', function (typeScope) {
            typeScope.assert(rejectsCall('no-matching-overload'), () => createTestFacade({ metadata: annotations }));
            typeScope.assert(rejectsCall('no-matching-overload'), () =>
                createTestFacade({
                    testFamily: 'microtest'
                }));
            typeScope.assert(
                rejectsCall('argument-type'),
                () => test({ body, metadata: { kind: 'microtest' }, title: 'passes' })
            );
            typeScope.assert(rejectsCall('argument-type'), () =>
                suite({
                    children: [ node ],
                    metadata: { ownership: [ '@runtime' ] },
                    title: 'group'
                }));
            typeScope.assert(acceptsCall, () =>
                table({
                    cases: [ { value: 1 } ],
                    controls: { capture: 'live' },
                    test: tableBody,
                    title: 'rows'
                }));
            typeScope.assert(acceptsCall, () =>
                runIfMain(import.meta, node, {
                    root: {
                        controls: engineControls,
                        title: 'root'
                    }
                }));
            return typeScope.assert.collect();
        })
    ])
]);

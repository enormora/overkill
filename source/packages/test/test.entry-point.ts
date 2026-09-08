export {
    createTestFacade,
    defineMacro,
    defineParameterizedTestBody,
    runIfMain,
    skippedTest,
    suite,
    table,
    test
} from './test-authoring.ts';
export type {
    RunIfMain,
    RunIfMainOptions,
    RunIfMainRootOptions,
    TestFacade
} from './test-authoring.ts';
export type {
    ParameterizedTestScope,
    TableDefinition,
    TableTestBody
} from './table-authoring.ts';

export { defineHarness } from './harness-authoring.ts';
export type {
    DefinedHarness,
    ExactHarnessOverrides,
    HarnessOverrides,
    HarnessPartFactories,
    HarnessPartFactory,
    HarnessParts
} from './harness-authoring.ts';

export {
    doubleUsage,
    rule,
    testAsyncDisposable,
    testAsyncIterable,
    testAsyncIterator,
    testDisposable,
    testDouble,
    testIterable,
    testIterator
} from '../doubles/doubles.entry-point.ts';
export type {
    AsyncDisposableConfiguration,
    AsyncIterableConfiguration,
    AsyncIteratorConfiguration,
    AsyncIteratorSource,
    DisposableConfiguration,
    DoubleCall,
    DoubleConstruction,
    DoubleHistory,
    DoubleInteraction,
    DoubleInvocation,
    DoubleIteratorEvent,
    DoubleIteratorReturnEvent,
    DoubleIteratorThrowEvent,
    DoubleIteratorYieldEvent,
    DoubleResult,
    DoubleReturnedResult,
    DoubleThrownResult,
    DoubleUsageAssertions,
    ProtocolMethodConfiguration,
    RuleFactory,
    SyncIterableConfiguration,
    SyncIteratorConfiguration,
    SyncIteratorSource,
    TestAsyncDisposable,
    TestAsyncDisposableFactory,
    TestAsyncIterable,
    TestAsyncIterableFactory,
    TestAsyncIterator,
    TestAsyncIteratorFactory,
    TestDisposable,
    TestDisposableFactory,
    TestDouble,
    TestDoubleFactory,
    TestIterable,
    TestIterableFactory,
    TestIterator,
    TestIteratorFactory
} from '../doubles/doubles.entry-point.ts';

export type {
    AuthoringMetadata,
    CaptureAuthoringMetadata,
    TestFacadeDefinition
} from './authoring-metadata.ts';

export type {
    OutputRenderer,
    Reporter,
    Suite,
    Table,
    TestBody,
    TestCase,
    TestFamily,
    TestNode,
    TestScope,
    TestScopeAssertContext
} from '../engine/engine.entry-point.ts';

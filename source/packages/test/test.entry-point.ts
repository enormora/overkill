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
export type { TestFacade } from './test-authoring.ts';
export type {
    RunIfMain,
    RunIfMainOptions,
    RunIfMainRootOptions
} from './authoring-test-data.ts';
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
    createTranscript,
    recordAsyncSink,
    recordSink,
    transcriptUsage
} from './interaction-transcript.ts';
export type {
    AsyncDisposableTranscript,
    DisposableTranscript,
    Transcript,
    TranscriptEntry,
    TranscriptUsageAssertions
} from './interaction-transcript.ts';

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
    AuthoringAnnotations,
    CaptureAuthoringControls,
    MicrotestAuthoringControls,
    TestFacadeDefinition
} from './authoring-test-data.ts';

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

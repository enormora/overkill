export { doubleUsage } from '../../doubles/double-usage.ts';
export { rule } from '../../doubles/double-rule.ts';
export {
    testAsyncDisposable,
    testAsyncIterable,
    testAsyncIterator,
    testDisposable,
    testIterable,
    testIterator
} from '../../doubles/protocol-double.ts';
export { testDouble } from '../../doubles/test-double.ts';
export type { DoubleUsageAssertions } from '../../doubles/double-usage.ts';
export type {
    DoubleInvocation
} from '../../doubles/double-behavior.ts';
export type {
    DoubleCall,
    DoubleConstruction,
    DoubleInteraction,
    DoubleIteratorEvent,
    DoubleIteratorReturnEvent,
    DoubleIteratorThrowEvent,
    DoubleIteratorYieldEvent,
    DoubleResult,
    DoubleReturnedResult,
    DoubleThrownResult
} from '../../doubles/double-history-record.ts';
export type {
    RuleFactory
} from '../../doubles/double-rule.ts';
export type {
    AsyncDisposableConfiguration,
    DisposableConfiguration,
    TestAsyncDisposable,
    TestDisposable
} from '../../doubles/protocol-disposable-double.ts';
export type {
    ProtocolMethodConfiguration,
    TestAsyncDisposableFactory,
    TestAsyncIterableFactory,
    TestAsyncIteratorFactory,
    TestDisposableFactory,
    TestIterableFactory,
    TestIteratorFactory
} from '../../doubles/protocol-double.ts';
export type {
    AsyncIterableConfiguration,
    AsyncIteratorConfiguration,
    AsyncIteratorSource,
    SyncIterableConfiguration,
    SyncIteratorConfiguration,
    SyncIteratorSource,
    TestAsyncIterable,
    TestAsyncIterator,
    TestIterable,
    TestIterator
} from '../../doubles/protocol-iterator-double.ts';
export type {
    DoubleHistory,
    TestDouble,
    TestDoubleFactory
} from '../../doubles/test-double.ts';

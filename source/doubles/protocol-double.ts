import {
    createTestAsyncDisposable,
    createTestDisposable
} from './protocol-disposable-double.ts';
import {
    createAsyncIterableFromFactory,
    createAsyncIterableFromMethod,
    createAsyncIteratorFromMethods,
    createConfiguredAsyncMethods,
    createConfiguredSyncMethods,
    createDefaultAsyncMethods,
    createDefaultSyncMethods,
    createDelegatingAsyncMethods,
    createDelegatingSyncMethods,
    createSyncIterableFromFactory,
    createSyncIterableFromMethod,
    createSyncIteratorFromMethods,
    createYieldingAsyncMethods,
    createYieldingSyncMethods
} from './protocol-iterator-double.ts';
import { testDouble } from './test-double.ts';
import type {
    AsyncDisposableConfiguration,
    AsyncIterableConfiguration,
    AsyncIteratorConfiguration,
    AsyncIteratorSource,
    DisposableConfiguration,
    SyncIterableConfiguration,
    SyncIteratorConfiguration,
    SyncIteratorSource,
    TestAsyncDisposable,
    TestAsyncIterable,
    TestAsyncIterator,
    TestDisposable,
    TestIterable,
    TestIterator
} from './protocol-double-types.ts';

export type TestIteratorFactory = {
    <YieldValue = unknown, ReturnValue = undefined, NextValue = unknown>(
        configuration: SyncIteratorConfiguration<YieldValue, ReturnValue>
    ): TestIterator<YieldValue, ReturnValue, NextValue>;
    (): TestIterator;
    readonly yields: {
        <YieldValue>(values: readonly YieldValue[]): TestIterator<YieldValue, undefined>;
        <YieldValue, ReturnValue>(
            values: readonly YieldValue[],
            returnValue: ReturnValue
        ): TestIterator<YieldValue, ReturnValue>;
    };
    readonly yieldsFrom: <YieldValue, ReturnValue = unknown, NextValue = unknown>(
        sourceFactory: () => SyncIteratorSource<YieldValue, ReturnValue>
    ) => TestIterator<YieldValue, ReturnValue, NextValue>;
};

export type TestAsyncIteratorFactory = {
    <YieldValue = unknown, ReturnValue = undefined, NextValue = unknown>(
        configuration: AsyncIteratorConfiguration<YieldValue, ReturnValue>
    ): TestAsyncIterator<YieldValue, ReturnValue, NextValue>;
    (): TestAsyncIterator;
    readonly yields: {
        <YieldValue>(values: readonly YieldValue[]): TestAsyncIterator<YieldValue, undefined>;
        <YieldValue, ReturnValue>(
            values: readonly YieldValue[],
            returnValue: ReturnValue
        ): TestAsyncIterator<YieldValue, ReturnValue>;
    };
    readonly yieldsFrom: <YieldValue, ReturnValue = unknown, NextValue = unknown>(
        sourceFactory: () => AsyncIteratorSource<YieldValue, ReturnValue>
    ) => TestAsyncIterator<YieldValue, ReturnValue, NextValue>;
};

export type TestIterableFactory = {
    <YieldValue = unknown, ReturnValue = undefined, NextValue = unknown>(
        configuration: SyncIterableConfiguration<YieldValue, ReturnValue, NextValue>
    ): TestIterable<YieldValue, ReturnValue, NextValue>;
    (): TestIterable;
    readonly yields: {
        <YieldValue>(values: readonly YieldValue[]): TestIterable<YieldValue, undefined>;
        <YieldValue, ReturnValue>(
            values: readonly YieldValue[],
            returnValue: ReturnValue
        ): TestIterable<YieldValue, ReturnValue>;
    };
    readonly yieldsFrom: <YieldValue, ReturnValue = unknown, NextValue = unknown>(
        sourceFactory: () => SyncIteratorSource<YieldValue, ReturnValue>
    ) => TestIterable<YieldValue, ReturnValue, NextValue>;
};

export type TestAsyncIterableFactory = {
    <YieldValue = unknown, ReturnValue = undefined, NextValue = unknown>(
        configuration: AsyncIterableConfiguration<YieldValue, ReturnValue, NextValue>
    ): TestAsyncIterable<YieldValue, ReturnValue, NextValue>;
    (): TestAsyncIterable;
    readonly yields: {
        <YieldValue>(values: readonly YieldValue[]): TestAsyncIterable<YieldValue, undefined>;
        <YieldValue, ReturnValue>(
            values: readonly YieldValue[],
            returnValue: ReturnValue
        ): TestAsyncIterable<YieldValue, ReturnValue>;
    };
    readonly yieldsFrom: <YieldValue, ReturnValue = unknown, NextValue = unknown>(
        sourceFactory: () => AsyncIteratorSource<YieldValue, ReturnValue>
    ) => TestAsyncIterable<YieldValue, ReturnValue, NextValue>;
};

export type TestDisposableFactory = (
    ...configuration: readonly [] | readonly [DisposableConfiguration]
) => TestDisposable;

export type TestAsyncDisposableFactory = (
    ...configuration: readonly [] | readonly [AsyncDisposableConfiguration]
) => TestAsyncDisposable;

function createTestIterator(
    ...configuration: readonly [] | readonly [SyncIteratorConfiguration<unknown, unknown>]
): TestIterator {
    return createSyncIteratorFromMethods(
        configuration[0] === undefined ? createDefaultSyncMethods() : createConfiguredSyncMethods(configuration[0])
    );
}

function createTestAsyncIterator(
    ...configuration: readonly [] | readonly [AsyncIteratorConfiguration<unknown, unknown>]
): TestAsyncIterator {
    return createAsyncIteratorFromMethods(
        configuration[0] === undefined ? createDefaultAsyncMethods() : createConfiguredAsyncMethods(configuration[0])
    );
}

function createTestIterable(
    ...configuration: readonly [] | readonly [SyncIterableConfiguration<unknown, unknown, unknown>]
): TestIterable {
    if (configuration[0] !== undefined) {
        return createSyncIterableFromMethod(testDouble(configuration[0].iterator));
    }

    return createSyncIterableFromFactory(function createIterator() {
        return createSyncIteratorFromMethods(createDefaultSyncMethods());
    });
}

function createTestAsyncIterable(
    ...configuration: readonly [] | readonly [AsyncIterableConfiguration<unknown, unknown, unknown>]
): TestAsyncIterable {
    if (configuration[0] !== undefined) {
        return createAsyncIterableFromMethod(testDouble(configuration[0].asyncIterator));
    }

    return createAsyncIterableFromFactory(function createIterator() {
        return createAsyncIteratorFromMethods(createDefaultAsyncMethods());
    });
}

function syncIteratorYields<YieldValue>(values: readonly YieldValue[]): TestIterator<YieldValue, undefined>;
function syncIteratorYields<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue: ReturnValue
): TestIterator<YieldValue, ReturnValue>;
function syncIteratorYields<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue?: ReturnValue
): TestIterator<YieldValue, ReturnValue | undefined> {
    return createSyncIteratorFromMethods(createYieldingSyncMethods(values, returnValue));
}

function syncIteratorYieldsFrom<YieldValue, ReturnValue = unknown>(
    sourceFactory: () => SyncIteratorSource<YieldValue, ReturnValue>
): TestIterator<YieldValue, ReturnValue> {
    return createSyncIteratorFromMethods(createDelegatingSyncMethods(sourceFactory));
}

export const testIterator: TestIteratorFactory = Object.assign(createTestIterator, {
    yields: syncIteratorYields,
    yieldsFrom: syncIteratorYieldsFrom
});

function asyncIteratorYields<YieldValue>(values: readonly YieldValue[]): TestAsyncIterator<YieldValue, undefined>;
function asyncIteratorYields<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue: ReturnValue
): TestAsyncIterator<YieldValue, ReturnValue>;
function asyncIteratorYields<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue?: ReturnValue
): TestAsyncIterator<YieldValue, ReturnValue | undefined> {
    return createAsyncIteratorFromMethods(createYieldingAsyncMethods(values, returnValue));
}

function asyncIteratorYieldsFrom<YieldValue, ReturnValue = unknown>(
    sourceFactory: () => AsyncIteratorSource<YieldValue, ReturnValue>
): TestAsyncIterator<YieldValue, ReturnValue> {
    return createAsyncIteratorFromMethods(createDelegatingAsyncMethods(sourceFactory));
}

export const testAsyncIterator: TestAsyncIteratorFactory = Object.assign(createTestAsyncIterator, {
    yields: asyncIteratorYields,
    yieldsFrom: asyncIteratorYieldsFrom
});

function syncIterableYields<YieldValue>(values: readonly YieldValue[]): TestIterable<YieldValue, undefined>;
function syncIterableYields<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue: ReturnValue
): TestIterable<YieldValue, ReturnValue>;
function syncIterableYields<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue?: ReturnValue
): TestIterable<YieldValue, ReturnValue | undefined> {
    return createSyncIterableFromFactory(function createIterator() {
        return createSyncIteratorFromMethods(createYieldingSyncMethods(values, returnValue));
    });
}

function syncIterableYieldsFrom<YieldValue, ReturnValue = unknown>(
    sourceFactory: () => SyncIteratorSource<YieldValue, ReturnValue>
): TestIterable<YieldValue, ReturnValue> {
    return createSyncIterableFromFactory(function createIterator() {
        return createSyncIteratorFromMethods(createDelegatingSyncMethods(sourceFactory));
    });
}

export const testIterable: TestIterableFactory = Object.assign(createTestIterable, {
    yields: syncIterableYields,
    yieldsFrom: syncIterableYieldsFrom
});

function asyncIterableYields<YieldValue>(values: readonly YieldValue[]): TestAsyncIterable<YieldValue, undefined>;
function asyncIterableYields<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue: ReturnValue
): TestAsyncIterable<YieldValue, ReturnValue>;
function asyncIterableYields<YieldValue, ReturnValue>(
    values: readonly YieldValue[],
    returnValue?: ReturnValue
): TestAsyncIterable<YieldValue, ReturnValue | undefined> {
    return createAsyncIterableFromFactory(function createIterator() {
        return createAsyncIteratorFromMethods(createYieldingAsyncMethods(values, returnValue));
    });
}

function asyncIterableYieldsFrom<YieldValue, ReturnValue = unknown>(
    sourceFactory: () => AsyncIteratorSource<YieldValue, ReturnValue>
): TestAsyncIterable<YieldValue, ReturnValue> {
    return createAsyncIterableFromFactory(function createIterator() {
        return createAsyncIteratorFromMethods(createDelegatingAsyncMethods(sourceFactory));
    });
}

export const testAsyncIterable: TestAsyncIterableFactory = Object.assign(createTestAsyncIterable, {
    yields: asyncIterableYields,
    yieldsFrom: asyncIterableYieldsFrom
});

export const testDisposable: TestDisposableFactory = createTestDisposable;
export const testAsyncDisposable: TestAsyncDisposableFactory = createTestAsyncDisposable;

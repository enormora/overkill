/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- TypeScript cannot see native symbol installation through computed runtime keys. */
import {
    asyncDisposeSymbol,
    disposeSymbol
} from './disposal-symbol.ts';
import { installProtocolMetadata } from './protocol-double-metadata.ts';
import {
    testDouble,
    type TestDouble,
    type TestDoubleConfiguration
} from './test-double.ts';

export type TestDisposable = Disposable & {
    readonly dispose: TestDouble<() => void>;
};

export type TestAsyncDisposable = AsyncDisposable & {
    readonly asyncDispose: TestDouble<() => Promise<void>>;
};

export type DisposableConfiguration = {
    readonly dispose: TestDoubleConfiguration<() => void>;
};

export type AsyncDisposableConfiguration = {
    readonly asyncDispose: TestDoubleConfiguration<() => Promise<void>>;
};

export function createTestDisposable(
    ...configuration: readonly [] | readonly [DisposableConfiguration]
): TestDisposable {
    const dispose = configuration[0] === undefined
        ? testDouble.returns<() => void>()
        : testDouble(configuration[0].dispose);
    const disposable = ({ dispose, [disposeSymbol]: dispose }) as unknown as TestDisposable;

    installProtocolMetadata(disposable, {
        disposeMethod() {
            return dispose;
        },
        iteratorEvents() {
            return [];
        },
        kind: 'disposable'
    });

    return disposable;
}

export function createTestAsyncDisposable(
    ...configuration: readonly [] | readonly [AsyncDisposableConfiguration]
): TestAsyncDisposable {
    const asyncDispose = configuration[0] === undefined
        ? testDouble.resolves<() => Promise<void>>(undefined)
        : testDouble(configuration[0].asyncDispose);
    const disposable = ({ asyncDispose, [asyncDisposeSymbol]: asyncDispose }) as unknown as TestAsyncDisposable;

    installProtocolMetadata(disposable, {
        disposeMethod() {
            return asyncDispose;
        },
        iteratorEvents() {
            return [];
        },
        kind: 'async-disposable'
    });

    return disposable;
}

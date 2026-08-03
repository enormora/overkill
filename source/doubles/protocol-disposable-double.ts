/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- TypeScript cannot see native symbol installation through computed runtime keys. */
import {
    asyncDisposeSymbol,
    disposeSymbol
} from './disposal-symbol.ts';
import { installProtocolMetadata } from './protocol-double-metadata.ts';
import type {
    AsyncDisposableConfiguration,
    DisposableConfiguration,
    TestAsyncDisposable,
    TestDisposable
} from './protocol-double-types.ts';
import { testDouble } from './test-double.ts';

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

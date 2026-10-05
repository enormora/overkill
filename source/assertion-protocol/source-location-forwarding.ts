import { AsyncLocalStorage } from 'node:async_hooks';
import type {
    NonEmptyReadonlyArray,
    ResolvableSourceLocation
} from './assertion-node-shape.ts';

const assertionSourceLocationStorageKey = Symbol.for('@overkill-dev/assertion-source-location-storage');

function isAssertionSourceLocationStorage(
    value: unknown
): value is AsyncLocalStorage<readonly ResolvableSourceLocation[]> {
    return value instanceof AsyncLocalStorage;
}

function assertionSourceLocationStorage(): AsyncLocalStorage<readonly ResolvableSourceLocation[]> {
    const existing: unknown = Reflect.get(globalThis, assertionSourceLocationStorageKey);

    if (isAssertionSourceLocationStorage(existing)) {
        return existing;
    }

    const storage = new AsyncLocalStorage<readonly ResolvableSourceLocation[]>();
    Reflect.set(globalThis, assertionSourceLocationStorageKey, storage);

    return storage;
}

function readActiveSourceLocations(): readonly ResolvableSourceLocation[] {
    return assertionSourceLocationStorage().getStore() ?? [];
}

function assertNonEmptySourceLocations(
    sourceLocations: readonly ResolvableSourceLocation[]
): asserts sourceLocations is NonEmptyReadonlyArray<ResolvableSourceLocation> {
    if (sourceLocations.length === 0) {
        throw new TypeError('Assertion source location forwarding requires at least one location.');
    }
}

export function sourceLocationsWithCurrentForwarding(
    captureLocation: () => ResolvableSourceLocation
): NonEmptyReadonlyArray<ResolvableSourceLocation> {
    const sourceLocations = [
        ...readActiveSourceLocations(),
        captureLocation()
    ];

    assertNonEmptySourceLocations(sourceLocations);

    return sourceLocations;
}

export function forwardAssertionSourceLocations<Result>(
    sourceLocations: NonEmptyReadonlyArray<ResolvableSourceLocation>,
    body: () => Result
): Result {
    assertNonEmptySourceLocations(sourceLocations);

    return assertionSourceLocationStorage().run([
        ...readActiveSourceLocations(),
        ...sourceLocations
    ], body);
}

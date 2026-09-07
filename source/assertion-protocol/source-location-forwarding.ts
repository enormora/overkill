import { AsyncLocalStorage } from 'node:async_hooks';
import type {
    NonEmptyReadonlyArray,
    ResolvableSourceLocation
} from './assertion-node-shape.ts';

const assertionSourceLocationStorage = new AsyncLocalStorage<readonly ResolvableSourceLocation[]>();

function readActiveSourceLocations(): readonly ResolvableSourceLocation[] {
    return assertionSourceLocationStorage.getStore() ?? [];
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

    return assertionSourceLocationStorage.run([
        ...readActiveSourceLocations(),
        ...sourceLocations
    ], body);
}

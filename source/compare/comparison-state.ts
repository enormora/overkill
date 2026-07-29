export type ComparisonState = {
    readonly actualToExpected: WeakMap<WeakKey, WeakKey>;
    readonly expectedToActual: WeakMap<WeakKey, WeakKey>;
};

export function createComparisonState(): ComparisonState {
    return {
        actualToExpected: new WeakMap<WeakKey, WeakKey>(),
        expectedToActual: new WeakMap<WeakKey, WeakKey>()
    };
}

export function objectPairStatus(
    actual: WeakKey,
    expected: WeakKey,
    state: ComparisonState
): 'new' | 'seen' | 'topology-mismatch' {
    const previousExpected = state.actualToExpected.get(actual);
    const previousActual = state.expectedToActual.get(expected);

    if (previousExpected === expected && previousActual === actual) {
        return 'seen';
    }

    if (previousExpected !== undefined || previousActual !== undefined) {
        return 'topology-mismatch';
    }

    state.actualToExpected.set(actual, expected);
    state.expectedToActual.set(expected, actual);

    return 'new';
}

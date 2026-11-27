import type { IsEqual } from 'type-fest';

export function isEqualTo<Expected>(): <Actual>(actual: Actual) => IsEqual<Actual, Expected> {
    throw new Error('Type relations are evaluated without running the test body.');
}

export function isAssignableTo<Expected>(): <Actual>(actual: Actual) => [Actual] extends [Expected] ? true : false {
    throw new Error('Type relations are evaluated without running the test body.');
}

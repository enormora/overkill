import type { IsEqual } from 'type-fest';

export function isEqualTo<Expected>(): <Actual>(actual: Actual) => IsEqual<Actual, Expected> {
    throw new Error('Type relations are evaluated without running the test body.');
}

export type IsAssignable<Actual, Expected> = [Actual] extends [Expected] ? true : false;
type HasKey<Actual, Key> = Key extends keyof Actual ? true : false;

export function isAssignableTo<Expected>(): <Actual>(actual: Actual) => IsAssignable<Actual, Expected> {
    throw new Error('Type relations are evaluated without running the test body.');
}

export function hasKey<Key>(): <Actual>(actual: Actual) => HasKey<Actual, Key> {
    throw new Error('Type relations are evaluated without running the test body.');
}

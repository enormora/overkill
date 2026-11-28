import type { IsLiteral, IsUnion } from 'type-fest';
import {
    createCompositeAssertionReferenceRecord,
    type CompositeAssertionReference,
    type CompositeAssertionReturn
} from '../engine/assertion-protocol.entry-point.ts';

const typeArgumentsBrand = Symbol.for('@overkill-dev/type-test/TypeArguments');

type ErasedTypeArguments<Types> = { readonly [typeArgumentsBrand]: Types | null; };

export type TypeAssertionReference<Arguments extends readonly unknown[], Types> = Readonly<
    CompositeAssertionReference<Arguments, CompositeAssertionReturn<'assert'>> & ErasedTypeArguments<Types>
>;

export type TypeRelationBindings = {
    <Actual, Expected>(): TypeAssertionReference<readonly [], readonly [Actual, Expected]>;
    readonly withActual: <Expected>() => TypeAssertionReference<readonly [actual: unknown], readonly [Expected]>;
    readonly withExpected: <Actual>() => TypeAssertionReference<readonly [expected: unknown], readonly [Actual]>;
    readonly expressions: TypeAssertionReference<readonly [actual: unknown, expected: unknown], readonly []>;
};

export function typeAssertionReference<Arguments extends readonly unknown[], Types>(
    relation: string,
    negated: boolean
): TypeAssertionReference<Arguments, Types> {
    const name = `${negated ? 'not ' : ''}${relation}`;
    const reference = createCompositeAssertionReferenceRecord<Arguments, never>({
        kind: 'composite',
        name,
        formatSummary: null,
        run() {
            throw new Error(
                `Type assertion "${name}" requires the type-test family; ordinary execution cannot check it.`
            );
        }
    });
    return Object.assign(reference, { [typeArgumentsBrand]: null });
}

function relationBindings(relation: string, negated: boolean): TypeRelationBindings {
    return Object.assign(function typedRelation<Actual, Expected>() {
        return typeAssertionReference<readonly [], readonly [Actual, Expected]>(relation, negated);
    }, {
        withActual<Expected>() {
            return typeAssertionReference<readonly [actual: unknown], readonly [Expected]>(relation, negated);
        },
        withExpected<Actual>() {
            return typeAssertionReference<readonly [expected: unknown], readonly [Actual]>(relation, negated);
        },
        expressions: typeAssertionReference<readonly [actual: unknown, expected: unknown], readonly []>(
            relation,
            negated
        )
    });
}

export function typeRelation(relation: string): TypeRelationBindings & { readonly not: TypeRelationBindings; } {
    return Object.assign(relationBindings(relation, false), { not: relationBindings(relation, true) });
}

export type TypeRelation = TypeRelationBindings & { readonly not: TypeRelationBindings; };

export type CallRejection = 'argument-count' | 'argument-type' | 'no-matching-overload';

export type CallReference = TypeAssertionReference<readonly [call: () => unknown], readonly []>;

const comparisonBrand = Symbol('TypeComparison');
const keyProjection = Symbol('keyProjection');

export type ComparisonReference<Actual, Expected> =
    TypeAssertionReference<readonly [], readonly [Actual, Expected]> & { readonly [comparisonBrand]: true; };

export type KeyReference<Actual, Key extends PropertyKey> = ComparisonReference<Actual, Key> & {
    readonly [keyProjection]: readonly [keyof Actual] | null;
};

export type KeyArguments<Key extends PropertyKey> = IsLiteral<Key> extends true
    ? IsUnion<Key> extends false ? readonly [] : readonly [singleKeyRequired: never]
    : readonly [singleKeyRequired: never];

export function isComparisonReference(value: unknown): boolean {
    return typeof value === 'object' && value !== null && Reflect.get(value, comparisonBrand) === true;
}

export function comparisonReference<Actual, Expected>(name: string): ComparisonReference<Actual, Expected> {
    return Object.assign(typeAssertionReference<readonly [], readonly [Actual, Expected]>(name, false), {
        [comparisonBrand]: true as const
    });
}

export function keyReference<Actual, Key extends PropertyKey>(name: string): KeyReference<Actual, Key> {
    return Object.assign(comparisonReference<Actual, Key>(name), { [keyProjection]: null });
}

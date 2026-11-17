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

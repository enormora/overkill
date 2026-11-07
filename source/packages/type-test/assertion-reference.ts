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

type RelationBindings = {
    <Actual, Expected>(): TypeAssertionReference<readonly [], readonly [Actual, Expected]>;
    readonly withActual: <Expected>() => TypeAssertionReference<readonly [actual: unknown], readonly [Expected]>;
    readonly withExpected: <Actual>() => TypeAssertionReference<readonly [expected: unknown], readonly [Actual]>;
    readonly expressions: TypeAssertionReference<readonly [actual: unknown, expected: unknown], readonly []>;
};

type AbilityBindings<Arguments extends readonly unknown[]> = {
    <Actual>(): TypeAssertionReference<Arguments, readonly [Actual]>;
    readonly withActual: TypeAssertionReference<readonly [actual: unknown, ...arguments_: Arguments], readonly []>;
};

export type TypeAbility<Arguments extends readonly unknown[]> = AbilityBindings<Arguments> & {
    readonly not: AbilityBindings<Arguments>;
};

export function typeAssertionReference<Arguments extends readonly unknown[], Types>(
    matcher: string,
    negated: boolean
): TypeAssertionReference<Arguments, Types> {
    const name = `${negated ? 'not ' : ''}${matcher}`;
    const reference = createCompositeAssertionReferenceRecord<Arguments, never>({
        kind: 'composite',
        name,
        formatSummary: null,
        run() {
            throw new Error(
                `Type assertion "${name}" requires the type-test adapter; ordinary execution cannot check it.`
            );
        }
    });
    return Object.assign(reference, { [typeArgumentsBrand]: null });
}

function relationBindings(matcher: string, negated: boolean): RelationBindings {
    return Object.assign(function relation<Actual, Expected>() {
        return typeAssertionReference<readonly [], readonly [Actual, Expected]>(matcher, negated);
    }, {
        withActual<Expected>() {
            return typeAssertionReference<readonly [actual: unknown], readonly [Expected]>(matcher, negated);
        },
        withExpected<Actual>() {
            return typeAssertionReference<readonly [expected: unknown], readonly [Actual]>(matcher, negated);
        },
        expressions: typeAssertionReference<readonly [actual: unknown, expected: unknown], readonly []>(
            matcher,
            negated
        )
    });
}

export function typeRelation(matcher: string): RelationBindings & { readonly not: RelationBindings; } {
    return Object.assign(relationBindings(matcher, false), { not: relationBindings(matcher, true) });
}

function abilityBindings<Arguments extends readonly unknown[]>(
    matcher: string,
    negated: boolean
): AbilityBindings<Arguments> {
    return Object.assign(function ability<Actual>() {
        return typeAssertionReference<Arguments, readonly [Actual]>(matcher, negated);
    }, {
        withActual: typeAssertionReference<readonly [actual: unknown, ...arguments_: Arguments], readonly []>(
            matcher,
            negated
        )
    });
}

export function typeAbility<Arguments extends readonly unknown[]>(
    matcher: string
): TypeAbility<Arguments> {
    return Object.assign(abilityBindings<Arguments>(matcher, false), {
        not: abilityBindings<Arguments>(matcher, true)
    });
}

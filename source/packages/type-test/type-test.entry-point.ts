import {
    typeAbility,
    typeAssertionReference,
    typeRelation,
    type TypeAssertionReference
} from './assertion-reference.ts';

export type { TypeAssertionReference } from './assertion-reference.ts';
export type { _ } from 'tstyche';

export const sameType = typeRelation('toBe');
export const assignableTo = typeRelation('toBeAssignableTo');
export const assignableFrom = typeRelation('toBeAssignableFrom');
export const acceptsProps = typeAbility<readonly [props: Record<string, unknown>]>('toAcceptProps');

export const callableWith = typeAbility<readonly unknown[]>('toBeCallableWith');
export const constructableWith = typeAbility<readonly unknown[]>('toBeConstructableWith');
export const hasProperty = typeAbility<readonly [key: PropertyKey]>('toHaveProperty');
export const raisesTypeError = typeAbility<readonly (RegExp | number | string)[]>('toRaiseError');

type InstantiationBindings = {
    <Actual, Arguments extends readonly unknown[]>(): TypeAssertionReference<readonly [], readonly [Actual, Arguments]>;
    readonly withActual: <Arguments extends readonly unknown[]>() => TypeAssertionReference<
        readonly [actual: unknown],
        readonly [Arguments]
    >;
};

function instantiationBindings(negated: boolean): InstantiationBindings {
    return Object.assign(function instantiation<Actual, Arguments extends readonly unknown[]>() {
        return typeAssertionReference<readonly [], readonly [Actual, Arguments]>('toBeInstantiableWith', negated);
    }, {
        withActual<Arguments extends readonly unknown[]>() {
            return typeAssertionReference<readonly [actual: unknown], readonly [Arguments]>(
                'toBeInstantiableWith',
                negated
            );
        }
    });
}

export const instantiableWith = Object.assign(instantiationBindings(false), { not: instantiationBindings(true) });

type DecoratorDeclaration<Decorator> = (apply: Decorator) => void;
type ApplicabilityBindings = {
    <Decorator>(): TypeAssertionReference<
        readonly [declaration: DecoratorDeclaration<Decorator>],
        readonly [Decorator]
    >;
    readonly withActual: <Decorator>(actual: Decorator) => TypeAssertionReference<
        readonly [declaration: DecoratorDeclaration<Decorator>],
        readonly [Decorator]
    >;
};

function applicabilityBindings(negated: boolean): ApplicabilityBindings {
    return Object.assign(function applicability<Decorator>() {
        return typeAssertionReference<readonly [declaration: DecoratorDeclaration<Decorator>], readonly [Decorator]>(
            'toBeApplicable',
            negated
        );
    }, {
        withActual<Decorator>() {
            return typeAssertionReference<
                readonly [declaration: DecoratorDeclaration<Decorator>],
                readonly [Decorator]
            >(
                'toBeApplicable',
                negated
            );
        }
    });
}
export const applicableTo = Object.assign(applicabilityBindings(false), { not: applicabilityBindings(true) });

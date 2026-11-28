import {
    comparisonReference,
    keyReference,
    typeAssertionReference,
    typeRelation,
    type CallReference,
    type CallRejection,
    type ComparisonReference,
    type KeyArguments,
    type KeyReference
} from './assertion-reference.ts';
import { typeTable } from './type-table.ts';

export type { TypeAssertionReference, TypeRelationBindings, TypeRelation } from './assertion-reference.ts';
export type { CallRejection } from './assertion-reference.ts';
export type { CompilerSelection, CompilerPolicy, TypeTestSettings } from './profile-settings.ts';
export { family } from './profile.entry-point.ts';

export const sameType = typeRelation('sameType');
export const assignableTo = typeRelation('assignableTo');
export const assignableFrom = typeRelation('assignableFrom');

export const acceptsCall: CallReference = typeAssertionReference('acceptsCall', false);

export function rejectsCall(reason: CallRejection): CallReference {
    return typeAssertionReference(`rejectsCall (${reason})`, false);
}

type TypeAssertions = {
    readonly equal: <Actual, Expected>() => ComparisonReference<Actual, Expected>;
    readonly notEqual: <Actual, Expected>() => ComparisonReference<Actual, Expected>;
    readonly assignableTo: <Actual, Expected>() => ComparisonReference<Actual, Expected>;
    readonly notAssignableTo: <Actual, Expected>() => ComparisonReference<Actual, Expected>;
    readonly hasKey: <Actual, Key extends PropertyKey>(...key: KeyArguments<Key>) => KeyReference<Actual, Key>;
    readonly lacksKey: <Actual, Key extends PropertyKey>(...key: KeyArguments<Key>) => KeyReference<Actual, Key>;
    readonly acceptsCall: CallReference;
    readonly rejectsCall: typeof rejectsCall;
    readonly table: typeof typeTable;
};

export const types: TypeAssertions = {
    equal<Actual, Expected>() {
        return comparisonReference<Actual, Expected>('equal');
    },
    notEqual<Actual, Expected>() {
        return comparisonReference<Actual, Expected>('notEqual');
    },
    assignableTo<Actual, Expected>() {
        return comparisonReference<Actual, Expected>('assignableTo');
    },
    notAssignableTo<Actual, Expected>() {
        return comparisonReference<Actual, Expected>('notAssignableTo');
    },
    hasKey<Actual, Key extends PropertyKey>(..._key: KeyArguments<Key>) {
        return keyReference<Actual, Key>('hasKey');
    },
    lacksKey<Actual, Key extends PropertyKey>(..._key: KeyArguments<Key>) {
        return keyReference<Actual, Key>('lacksKey');
    },
    acceptsCall,
    rejectsCall,
    table: typeTable
};

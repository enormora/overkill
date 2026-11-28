import {
    comparisonReference,
    keyReference,
    typeAssertionReference,
    typeRelation,
    type CallReference,
    type CallRejection,
    type KeyArguments
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

export const types = {
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

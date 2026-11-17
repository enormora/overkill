import { typeRelation } from './assertion-reference.ts';

export type { TypeAssertionReference, TypeRelationBindings, TypeRelation } from './assertion-reference.ts';
export type { CompilerSelection, CompilerPolicy, TypeTestSettings } from './profile-settings.ts';
export { family } from './profile.entry-point.ts';

export const sameType = typeRelation('sameType');
export const assignableTo = typeRelation('assignableTo');
export const assignableFrom = typeRelation('assignableFrom');

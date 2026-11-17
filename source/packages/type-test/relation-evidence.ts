export type Relation = 'assignableFrom' | 'assignableTo' | 'sameType';
type EstablishedRelation = { readonly kind: 'established'; readonly holds: boolean; };
type InconclusiveRelation = { readonly kind: 'inconclusive'; readonly reason: string; };
export type RelationEvidence = EstablishedRelation | InconclusiveRelation;

export function established(holds: boolean): RelationEvidence {
    return { kind: 'established', holds };
}

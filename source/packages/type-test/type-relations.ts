import type { Type } from 'typescript-beta/async';
import type { TypeAnalysis } from './type-analysis.ts';
import { compareEquality } from './structural-equality.ts';
import { established, type Relation, type RelationEvidence } from './relation-evidence.ts';

export async function compareRelation(
    analysis: TypeAnalysis,
    relation: Relation,
    actual: Type,
    expected: Type
): Promise<RelationEvidence> {
    if (actual.isErrorType() || expected.isErrorType()) {
        throw new Error('Recovery types cannot establish a type relation.');
    }
    if (relation === 'sameType') {
        return await compareEquality(analysis, actual, expected);
    }
    return established(
        await analysis.checker.isTypeAssignableTo(
            relation === 'assignableTo' ? actual : expected,
            relation === 'assignableTo' ? expected : actual
        )
    );
}

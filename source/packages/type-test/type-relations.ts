import type { Type } from 'typescript-beta/async';
import type { TypeAnalysis } from './source-analysis-port.ts';
import { invalidOperand } from './operand-evidence.ts';
import { compareEquality } from './structural-equality.ts';
import { established, type Relation, type RelationEvidence } from './relation-evidence.ts';

export async function compareRelation(
    analysis: TypeAnalysis,
    relation: Relation,
    actual: Type,
    expected: Type
): Promise<RelationEvidence> {
    const invalid = await invalidOperand(analysis, [ actual, expected ]);
    if (invalid !== null) {
        return { kind: 'inconclusive', reason: invalid };
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

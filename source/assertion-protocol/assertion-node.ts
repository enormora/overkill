import { booleanSummaryByCheck, type FalseAssertionNode, type TrueAssertionNode } from './assertions/boolean.ts';
import {
    collectionSummaryByCheck,
    type EmptinessAssertionNode,
    type LengthAssertionNode
} from './assertions/collection.ts';
import {
    equalitySummaryByCheck,
    type DeepEqualAssertionNode,
    type EqualAssertionNode,
    type NotDeepEqualAssertionNode,
    type NotEqualAssertionNode
} from './assertions/equality.ts';
import { failSummaryByCheck, type FailAssertionNode } from './assertions/fail.ts';
import {
    numericSummaryByCheck,
    type BetweenAssertionNode,
    type NumericComparisonAssertionNode
} from './assertions/numeric.ts';
import {
    partialSummaryByCheck,
    type ArrayContainsPartialAssertionNode,
    type MembersPartialDeepEqualAssertionNode,
    type PartialDeepEqualAssertionNode
} from './assertions/partial.ts';
import {
    presenceSummaryByCheck,
    type DefinedAssertionNode,
    type NotNullAssertionNode,
    type NullAssertionNode,
    type UndefinedAssertionNode
} from './assertions/presence.ts';
import {
    stringSummaryByCheck,
    type MatchAssertionNode,
    type StringContainsAssertionNode
} from './assertions/string.ts';
import {
    typeShapeSummaryByCheck,
    type HasPropertyAssertionNode,
    type InstanceOfAssertionNode,
    type TypeAssertionNode
} from './assertions/type-shape.ts';
import type { NonEmptyReadonlyArray } from './assertion-node-shape.ts';

type RequireAssertionNodeByName = {
    readonly defined: DefinedAssertionNode<'require'>;
    readonly hasProperty: HasPropertyAssertionNode<'require'>;
    readonly instanceOf: InstanceOfAssertionNode<'require'>;
    readonly notNull: NotNullAssertionNode<'require'>;
    readonly null: NullAssertionNode<'require'>;
    readonly type: TypeAssertionNode<'require'>;
};

type AssertAssertionNodeByName = {
    readonly arrayContainsPartial: ArrayContainsPartialAssertionNode<'assert'>;
    readonly between: BetweenAssertionNode<'assert'>;
    readonly deepEqual: DeepEqualAssertionNode<'assert'>;
    readonly defined: DefinedAssertionNode<'assert'>;
    readonly emptiness: EmptinessAssertionNode<'assert'>;
    readonly equal: EqualAssertionNode<'assert'>;
    readonly fail: FailAssertionNode<'assert'>;
    readonly false: FalseAssertionNode<'assert'>;
    readonly hasProperty: HasPropertyAssertionNode<'assert'>;
    readonly instanceOf: InstanceOfAssertionNode<'assert'>;
    readonly length: LengthAssertionNode<'assert'>;
    readonly match: MatchAssertionNode<'assert'>;
    readonly membersPartialDeepEqual: MembersPartialDeepEqualAssertionNode<'assert'>;
    readonly notDeepEqual: NotDeepEqualAssertionNode<'assert'>;
    readonly notEqual: NotEqualAssertionNode<'assert'>;
    readonly notNull: NotNullAssertionNode<'assert'>;
    readonly null: NullAssertionNode<'assert'>;
    readonly numericComparison: NumericComparisonAssertionNode<'assert'>;
    readonly partialDeepEqual: PartialDeepEqualAssertionNode<'assert'>;
    readonly stringContains: StringContainsAssertionNode<'assert'>;
    readonly true: TrueAssertionNode<'assert'>;
    readonly type: TypeAssertionNode<'assert'>;
    readonly undefined: UndefinedAssertionNode<'assert'>;
};

export type RequireAssertionNode = RequireAssertionNodeByName[keyof RequireAssertionNodeByName];

export type AssertAssertionNode = AssertAssertionNodeByName[keyof AssertAssertionNodeByName];

export type AssertionNode = AssertAssertionNode | RequireAssertionNode;

export type AssertionResult = AssertAssertionNode | NonEmptyReadonlyArray<AssertAssertionNode>;

const defaultSummaryByCheck: Readonly<Record<AssertionNode['check'], string>> = {
    ...booleanSummaryByCheck,
    ...collectionSummaryByCheck,
    ...equalitySummaryByCheck,
    ...failSummaryByCheck,
    ...numericSummaryByCheck,
    ...partialSummaryByCheck,
    ...presenceSummaryByCheck,
    ...stringSummaryByCheck,
    ...typeShapeSummaryByCheck
};

export function assertionSummary(assertion: AssertionNode): string {
    return assertion.message ?? defaultSummaryByCheck[assertion.check];
}

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
import type {
    AssertionSource,
    NonEmptyReadonlyArray,
    ResolvableSourceLocation
} from './assertion-node-shape.ts';

type ForeignAssertionErrorRecord = {
    readonly message: string;
    readonly name: string;
    readonly stack: string | null;
    readonly thrown: unknown;
};

type RequireAssertionNodeByName = {
    readonly defined: DefinedAssertionNode<'require'>;
    readonly hasProperty: HasPropertyAssertionNode<'require'>;
    readonly instanceOf: InstanceOfAssertionNode<'require'>;
    readonly notNull: NotNullAssertionNode<'require'>;
    readonly null: NullAssertionNode<'require'>;
    readonly type: TypeAssertionNode<'require'>;
};

type BuiltInAssertAssertionNodeByName<Source extends AssertionSource> = {
    readonly arrayContainsPartial: ArrayContainsPartialAssertionNode<Source>;
    readonly between: BetweenAssertionNode<Source>;
    readonly deepEqual: DeepEqualAssertionNode<Source>;
    readonly defined: DefinedAssertionNode<Source>;
    readonly emptiness: EmptinessAssertionNode<Source>;
    readonly equal: EqualAssertionNode<Source>;
    readonly fail: FailAssertionNode<Source>;
    readonly false: FalseAssertionNode<Source>;
    readonly hasProperty: HasPropertyNode<Source>;
    readonly instanceOf: InstanceOfAssertionNode<Source>;
    readonly length: LengthAssertionNode<Source>;
    readonly match: MatchAssertionNode<Source>;
    readonly membersPartialDeepEqual: MembersPartialDeepEqualAssertionNode<Source>;
    readonly notDeepEqual: NotDeepEqualAssertionNode<Source>;
    readonly notEqual: NotEqualAssertionNode<Source>;
    readonly notNull: NotNullAssertionNode<Source>;
    readonly null: NullAssertionNode<Source>;
    readonly numericComparison: NumericComparisonAssertionNode<Source>;
    readonly partialDeepEqual: PartialDeepEqualAssertionNode<Source>;
    readonly stringContains: StringContainsAssertionNode<Source>;
    readonly true: TrueAssertionNode<Source>;
    readonly type: TypeAssertionNode<Source>;
    readonly undefined: UndefinedAssertionNode<Source>;
};

type HasPropertyNode<Source extends AssertionSource> = HasPropertyAssertionNode<Source>;

export type BuiltInAssertAssertionNode<Source extends AssertionSource = 'assert'> = BuiltInAssertAssertionNodeByName<
    Source
>[keyof BuiltInAssertAssertionNodeByName<Source>];

type ForeignAssertionResultByOutcome = {
    readonly fail: {
        readonly error: ForeignAssertionErrorRecord;
        readonly passed: false;
    };
    readonly pass: {
        readonly passed: true;
    };
};

export type ForeignAssertionResult = ForeignAssertionResultByOutcome[keyof ForeignAssertionResultByOutcome];

export type ForeignAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly check: 'foreign';
    readonly label: string;
    readonly location: ResolvableSourceLocation;
    readonly message: string | null;
    readonly result: ForeignAssertionResult;
    readonly source: Source;
    readonly summary: string;
};

type CompositeAssertionChildNodeByKind<Source extends AssertionSource> = {
    readonly builtIn: BuiltInAssertAssertionNode<Source>;
    readonly foreign: ForeignAssertionNode<Source>;
};

export type CompositeAssertionChildNode<Source extends AssertionSource = AssertionSource> =
    CompositeAssertionChildNodeByKind<Source>[keyof CompositeAssertionChildNodeByKind<Source>];

export type CompositeAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly actual: unknown;
    readonly check: 'composite';
    readonly children: NonEmptyReadonlyArray<CompositeAssertionChildNode<Source>>;
    readonly expected: unknown;
    readonly location: ResolvableSourceLocation;
    readonly message: string | null;
    readonly name: string;
    readonly source: Source;
    readonly summary: string;
};

type RequireAssertionNodeByKind = RequireAssertionNodeByName & {
    readonly composite: CompositeAssertionNode<'require'>;
};

export type RequireAssertionNode = RequireAssertionNodeByKind[keyof RequireAssertionNodeByKind];

export type AssertAssertionNode = BuiltInAssertAssertionNode | CompositeAssertionNode<'assert'>;

export type AssertionNode = AssertAssertionNode | RequireAssertionNode;

export type AssertionResult = AssertAssertionNode | NonEmptyReadonlyArray<AssertAssertionNode>;

const defaultSummaryByCheck: Readonly<Record<BuiltInAssertAssertionNode['check'], string>> = {
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

type SummarizedAssertionNode = AssertionNode | CompositeAssertionChildNode | CompositeAssertionNode;

function isCompositeAssertion(
    assertion: SummarizedAssertionNode
): assertion is CompositeAssertionNode {
    return assertion.check === 'composite';
}

export function assertionSummary(assertion: SummarizedAssertionNode): string {
    if (isCompositeAssertion(assertion)) {
        return assertion.message ?? assertion.summary;
    }

    if (assertion.check === 'foreign') {
        return assertion.message ?? assertion.summary;
    }

    return assertion.message ?? defaultSummaryByCheck[assertion.check];
}

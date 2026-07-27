import type { AssertionOutcome } from '../assertion-evaluation.ts';
import { evaluateFalse, evaluateTrue, type FalseAssertionNode, type TrueAssertionNode } from './boolean.ts';
import {
    evaluateEmpty,
    evaluateLength,
    evaluateNotEmpty,
    type EmptinessAssertionNode,
    type LengthAssertionNode
} from './collection.ts';
import {
    evaluateDeepEqual,
    evaluateEqual,
    evaluateNotDeepEqual,
    evaluateNotEqual,
    type DeepEqualAssertionNode,
    type EqualAssertionNode,
    type NotDeepEqualAssertionNode,
    type NotEqualAssertionNode
} from './equality.ts';
import { evaluateFail, type FailAssertionNode } from './fail.ts';
import {
    evaluateBetween,
    evaluateGreaterThan,
    evaluateGreaterThanOrEqual,
    evaluateLessThan,
    evaluateLessThanOrEqual,
    type BetweenAssertionNode,
    type NumericComparisonAssertionNode
} from './numeric.ts';
import {
    evaluateArrayContainsPartial,
    evaluateMembersPartialDeepEqual,
    evaluatePartialDeepEqual,
    type ArrayContainsPartialAssertionNode,
    type MembersPartialDeepEqualAssertionNode,
    type PartialDeepEqualAssertionNode
} from './partial.ts';
import {
    evaluateDefined,
    evaluateNotNull,
    evaluateNull,
    evaluateUndefined,
    type DefinedAssertionNode,
    type NotNullAssertionNode,
    type NullAssertionNode,
    type UndefinedAssertionNode
} from './presence.ts';
import {
    evaluateEndsWith,
    evaluateIncludes,
    evaluateMatch,
    evaluateNotMatch,
    evaluateStartsWith,
    type MatchAssertionNode,
    type StringContainsAssertionNode
} from './string.ts';
import {
    evaluateArray,
    evaluateBoolean,
    evaluateFunction,
    evaluateHasProperty,
    evaluateInstanceOf,
    evaluateNumber,
    evaluateObject,
    evaluateString,
    type HasPropertyAssertionNode,
    type InstanceOfAssertionNode,
    type TypeAssertionNode
} from './type-shape.ts';

export type AssertionNodeByCheck = {
    readonly array: Extract<TypeAssertionNode, { readonly check: 'array'; }>;
    readonly 'array-contains-partial': ArrayContainsPartialAssertionNode;
    readonly between: BetweenAssertionNode;
    readonly boolean: Extract<TypeAssertionNode, { readonly check: 'boolean'; }>;
    readonly 'deep-equal': DeepEqualAssertionNode;
    readonly defined: DefinedAssertionNode;
    readonly empty: Extract<EmptinessAssertionNode, { readonly check: 'empty'; }>;
    readonly 'ends-with': Extract<StringContainsAssertionNode, { readonly check: 'ends-with'; }>;
    readonly equal: EqualAssertionNode;
    readonly fail: FailAssertionNode;
    readonly false: FalseAssertionNode;
    readonly function: Extract<TypeAssertionNode, { readonly check: 'function'; }>;
    readonly 'greater-than': Extract<NumericComparisonAssertionNode, { readonly check: 'greater-than'; }>;
    readonly 'greater-than-or-equal': Extract<
        NumericComparisonAssertionNode,
        { readonly check: 'greater-than-or-equal'; }
    >;
    readonly 'has-property': HasPropertyAssertionNode;
    readonly includes: Extract<StringContainsAssertionNode, { readonly check: 'includes'; }>;
    readonly 'instance-of': InstanceOfAssertionNode;
    readonly length: LengthAssertionNode;
    readonly 'less-than': Extract<NumericComparisonAssertionNode, { readonly check: 'less-than'; }>;
    readonly 'less-than-or-equal': Extract<NumericComparisonAssertionNode, { readonly check: 'less-than-or-equal'; }>;
    readonly match: Extract<MatchAssertionNode, { readonly check: 'match'; }>;
    readonly 'members-partial-deep-equal': MembersPartialDeepEqualAssertionNode;
    readonly 'not-deep-equal': NotDeepEqualAssertionNode;
    readonly 'not-empty': Extract<EmptinessAssertionNode, { readonly check: 'not-empty'; }>;
    readonly 'not-equal': NotEqualAssertionNode;
    readonly 'not-match': Extract<MatchAssertionNode, { readonly check: 'not-match'; }>;
    readonly 'not-null': NotNullAssertionNode;
    readonly null: NullAssertionNode;
    readonly number: Extract<TypeAssertionNode, { readonly check: 'number'; }>;
    readonly object: Extract<TypeAssertionNode, { readonly check: 'object'; }>;
    readonly 'partial-deep-equal': PartialDeepEqualAssertionNode;
    readonly 'starts-with': Extract<StringContainsAssertionNode, { readonly check: 'starts-with'; }>;
    readonly string: Extract<TypeAssertionNode, { readonly check: 'string'; }>;
    readonly true: TrueAssertionNode;
    readonly undefined: UndefinedAssertionNode;
};

type AssertionCheck = keyof AssertionNodeByCheck;

export type AssertionEvaluatorByCheck = {
    readonly [Check in AssertionCheck]: (assertion: AssertionNodeByCheck[Check]) => AssertionOutcome;
};

export const assertionEvaluatorByCheck: AssertionEvaluatorByCheck = {
    array: evaluateArray,
    'array-contains-partial': evaluateArrayContainsPartial,
    between: evaluateBetween,
    boolean: evaluateBoolean,
    'deep-equal': evaluateDeepEqual,
    defined: evaluateDefined,
    empty: evaluateEmpty,
    'ends-with': evaluateEndsWith,
    equal: evaluateEqual,
    fail: evaluateFail,
    false: evaluateFalse,
    function: evaluateFunction,
    'greater-than': evaluateGreaterThan,
    'greater-than-or-equal': evaluateGreaterThanOrEqual,
    'has-property': evaluateHasProperty,
    includes: evaluateIncludes,
    'instance-of': evaluateInstanceOf,
    length: evaluateLength,
    'less-than': evaluateLessThan,
    'less-than-or-equal': evaluateLessThanOrEqual,
    match: evaluateMatch,
    'members-partial-deep-equal': evaluateMembersPartialDeepEqual,
    'not-deep-equal': evaluateNotDeepEqual,
    'not-empty': evaluateNotEmpty,
    'not-equal': evaluateNotEqual,
    'not-match': evaluateNotMatch,
    'not-null': evaluateNotNull,
    null: evaluateNull,
    number: evaluateNumber,
    object: evaluateObject,
    'partial-deep-equal': evaluatePartialDeepEqual,
    'starts-with': evaluateStartsWith,
    string: evaluateString,
    true: evaluateTrue,
    undefined: evaluateUndefined
};

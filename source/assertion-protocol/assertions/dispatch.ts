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

type AssertionNodeByCheck = {
    readonly array: TypeAssertionNode;
    readonly 'array-contains-partial': ArrayContainsPartialAssertionNode;
    readonly between: BetweenAssertionNode;
    readonly boolean: TypeAssertionNode;
    readonly 'deep-equal': DeepEqualAssertionNode;
    readonly defined: DefinedAssertionNode;
    readonly empty: EmptinessAssertionNode;
    readonly 'ends-with': StringContainsAssertionNode;
    readonly equal: EqualAssertionNode;
    readonly fail: FailAssertionNode;
    readonly false: FalseAssertionNode;
    readonly function: TypeAssertionNode;
    readonly 'greater-than': NumericComparisonAssertionNode;
    readonly 'greater-than-or-equal': NumericComparisonAssertionNode;
    readonly 'has-property': HasPropertyAssertionNode;
    readonly includes: StringContainsAssertionNode;
    readonly 'instance-of': InstanceOfAssertionNode;
    readonly length: LengthAssertionNode;
    readonly 'less-than': NumericComparisonAssertionNode;
    readonly 'less-than-or-equal': NumericComparisonAssertionNode;
    readonly match: MatchAssertionNode;
    readonly 'members-partial-deep-equal': MembersPartialDeepEqualAssertionNode;
    readonly 'not-deep-equal': NotDeepEqualAssertionNode;
    readonly 'not-empty': EmptinessAssertionNode;
    readonly 'not-equal': NotEqualAssertionNode;
    readonly 'not-match': MatchAssertionNode;
    readonly 'not-null': NotNullAssertionNode;
    readonly null: NullAssertionNode;
    readonly number: TypeAssertionNode;
    readonly object: TypeAssertionNode;
    readonly 'partial-deep-equal': PartialDeepEqualAssertionNode;
    readonly 'starts-with': StringContainsAssertionNode;
    readonly string: TypeAssertionNode;
    readonly true: TrueAssertionNode;
    readonly undefined: UndefinedAssertionNode;
};

type AssertionCheck = keyof AssertionNodeByCheck;

type DispatchableAssertionNode = AssertionNodeByCheck[AssertionCheck];

type AssertionEvaluatorByCheck = Readonly<
    Record<
        AssertionCheck,
        (assertion: DispatchableAssertionNode) => AssertionOutcome
    >
>;

function unexpectedAssertion(expected: AssertionCheck, assertion: DispatchableAssertionNode): never {
    throw new TypeError(`Expected ${expected} assertion, got ${assertion.check}.`);
}

const assertionEvaluatorByCheck: AssertionEvaluatorByCheck = {
    array(assertion) {
        return assertion.check === 'array' ? evaluateArray(assertion) : unexpectedAssertion('array', assertion);
    },

    'array-contains-partial'(assertion) {
        return assertion.check === 'array-contains-partial'
            ? evaluateArrayContainsPartial(assertion)
            : unexpectedAssertion('array-contains-partial', assertion);
    },

    between(assertion) {
        return assertion.check === 'between' ? evaluateBetween(assertion) : unexpectedAssertion('between', assertion);
    },

    boolean(assertion) {
        return assertion.check === 'boolean'
            ? evaluateBoolean(assertion)
            : unexpectedAssertion('boolean', assertion);
    },

    'deep-equal'(assertion) {
        return assertion.check === 'deep-equal'
            ? evaluateDeepEqual(assertion)
            : unexpectedAssertion('deep-equal', assertion);
    },

    defined(assertion) {
        return assertion.check === 'defined'
            ? evaluateDefined(assertion)
            : unexpectedAssertion('defined', assertion);
    },

    empty(assertion) {
        return assertion.check === 'empty' ? evaluateEmpty(assertion) : unexpectedAssertion('empty', assertion);
    },

    'ends-with'(assertion) {
        return assertion.check === 'ends-with'
            ? evaluateEndsWith(assertion)
            : unexpectedAssertion('ends-with', assertion);
    },

    equal(assertion) {
        return assertion.check === 'equal' ? evaluateEqual(assertion) : unexpectedAssertion('equal', assertion);
    },

    fail(assertion) {
        return assertion.check === 'fail' ? evaluateFail(assertion) : unexpectedAssertion('fail', assertion);
    },

    false(assertion) {
        return assertion.check === 'false' ? evaluateFalse(assertion) : unexpectedAssertion('false', assertion);
    },

    function(assertion) {
        return assertion.check === 'function'
            ? evaluateFunction(assertion)
            : unexpectedAssertion('function', assertion);
    },

    'greater-than'(assertion) {
        return assertion.check === 'greater-than'
            ? evaluateGreaterThan(assertion)
            : unexpectedAssertion('greater-than', assertion);
    },

    'greater-than-or-equal'(assertion) {
        return assertion.check === 'greater-than-or-equal'
            ? evaluateGreaterThanOrEqual(assertion)
            : unexpectedAssertion('greater-than-or-equal', assertion);
    },

    'has-property'(assertion) {
        return assertion.check === 'has-property'
            ? evaluateHasProperty(assertion)
            : unexpectedAssertion('has-property', assertion);
    },

    includes(assertion) {
        return assertion.check === 'includes'
            ? evaluateIncludes(assertion)
            : unexpectedAssertion('includes', assertion);
    },

    'instance-of'(assertion) {
        return assertion.check === 'instance-of'
            ? evaluateInstanceOf(assertion)
            : unexpectedAssertion('instance-of', assertion);
    },

    length(assertion) {
        return assertion.check === 'length' ? evaluateLength(assertion) : unexpectedAssertion('length', assertion);
    },

    'less-than'(assertion) {
        return assertion.check === 'less-than'
            ? evaluateLessThan(assertion)
            : unexpectedAssertion('less-than', assertion);
    },

    'less-than-or-equal'(assertion) {
        return assertion.check === 'less-than-or-equal'
            ? evaluateLessThanOrEqual(assertion)
            : unexpectedAssertion('less-than-or-equal', assertion);
    },

    match(assertion) {
        return assertion.check === 'match' ? evaluateMatch(assertion) : unexpectedAssertion('match', assertion);
    },

    'members-partial-deep-equal'(assertion) {
        return assertion.check === 'members-partial-deep-equal'
            ? evaluateMembersPartialDeepEqual(assertion)
            : unexpectedAssertion('members-partial-deep-equal', assertion);
    },

    'not-deep-equal'(assertion) {
        return assertion.check === 'not-deep-equal'
            ? evaluateNotDeepEqual(assertion)
            : unexpectedAssertion('not-deep-equal', assertion);
    },

    'not-empty'(assertion) {
        return assertion.check === 'not-empty'
            ? evaluateNotEmpty(assertion)
            : unexpectedAssertion('not-empty', assertion);
    },

    'not-equal'(assertion) {
        return assertion.check === 'not-equal'
            ? evaluateNotEqual(assertion)
            : unexpectedAssertion('not-equal', assertion);
    },

    'not-match'(assertion) {
        return assertion.check === 'not-match'
            ? evaluateNotMatch(assertion)
            : unexpectedAssertion('not-match', assertion);
    },

    'not-null'(assertion) {
        return assertion.check === 'not-null'
            ? evaluateNotNull(assertion)
            : unexpectedAssertion('not-null', assertion);
    },

    null(assertion) {
        return assertion.check === 'null' ? evaluateNull(assertion) : unexpectedAssertion('null', assertion);
    },

    number(assertion) {
        return assertion.check === 'number' ? evaluateNumber(assertion) : unexpectedAssertion('number', assertion);
    },

    object(assertion) {
        return assertion.check === 'object' ? evaluateObject(assertion) : unexpectedAssertion('object', assertion);
    },

    'partial-deep-equal'(assertion) {
        return assertion.check === 'partial-deep-equal'
            ? evaluatePartialDeepEqual(assertion)
            : unexpectedAssertion('partial-deep-equal', assertion);
    },

    'starts-with'(assertion) {
        return assertion.check === 'starts-with'
            ? evaluateStartsWith(assertion)
            : unexpectedAssertion('starts-with', assertion);
    },

    string(assertion) {
        return assertion.check === 'string' ? evaluateString(assertion) : unexpectedAssertion('string', assertion);
    },

    true(assertion) {
        return assertion.check === 'true' ? evaluateTrue(assertion) : unexpectedAssertion('true', assertion);
    },

    undefined(assertion) {
        return assertion.check === 'undefined'
            ? evaluateUndefined(assertion)
            : unexpectedAssertion('undefined', assertion);
    }
};

export function evaluateAssertionNode(assertion: DispatchableAssertionNode): AssertionOutcome {
    return assertionEvaluatorByCheck[assertion.check](assertion);
}

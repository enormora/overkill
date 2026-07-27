import { evaluateFalse, evaluateTrue } from './boolean.ts';
import { evaluateEmpty, evaluateLength, evaluateNotEmpty } from './collection.ts';
import { evaluateDeepEqual, evaluateEqual, evaluateNotDeepEqual, evaluateNotEqual } from './equality.ts';
import { evaluateFail } from './fail.ts';
import {
    evaluateBetween,
    evaluateGreaterThan,
    evaluateGreaterThanOrEqual,
    evaluateLessThan,
    evaluateLessThanOrEqual
} from './numeric.ts';
import {
    evaluateArrayContainsPartial,
    evaluateMembersPartialDeepEqual,
    evaluatePartialDeepEqual
} from './partial.ts';
import { evaluateDefined, evaluateNotNull, evaluateNull, evaluateUndefined } from './presence.ts';
import {
    evaluateEndsWith,
    evaluateIncludes,
    evaluateMatch,
    evaluateNotMatch,
    evaluateStartsWith
} from './string.ts';
import {
    evaluateArray,
    evaluateBoolean,
    evaluateFunction,
    evaluateHasProperty,
    evaluateInstanceOf,
    evaluateNumber,
    evaluateObject,
    evaluateString
} from './type-shape.ts';

export const assertionEvaluators = [
    evaluateArray,
    evaluateArrayContainsPartial,
    evaluateBetween,
    evaluateBoolean,
    evaluateDeepEqual,
    evaluateDefined,
    evaluateEmpty,
    evaluateEndsWith,
    evaluateEqual,
    evaluateFail,
    evaluateFalse,
    evaluateFunction,
    evaluateGreaterThan,
    evaluateGreaterThanOrEqual,
    evaluateHasProperty,
    evaluateIncludes,
    evaluateInstanceOf,
    evaluateLength,
    evaluateLessThan,
    evaluateLessThanOrEqual,
    evaluateMatch,
    evaluateMembersPartialDeepEqual,
    evaluateNotDeepEqual,
    evaluateNotEmpty,
    evaluateNotEqual,
    evaluateNotMatch,
    evaluateNotNull,
    evaluateNull,
    evaluateNumber,
    evaluateObject,
    evaluatePartialDeepEqual,
    evaluateStartsWith,
    evaluateString,
    evaluateTrue,
    evaluateUndefined
] as const;

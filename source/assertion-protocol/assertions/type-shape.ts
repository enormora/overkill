import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import {
    hasAssertionCheck,
    type ActualAssertionNode,
    type AssertionCandidate,
    type AssertionSource,
    type InstanceConstructor
} from '../assertion-node-shape.ts';
import { isPlainObject } from '../partial-matching.ts';

export type TypeAssertionNode<Source extends AssertionSource = AssertionSource> = ActualAssertionNode<
    Source,
    'array' | 'boolean' | 'function' | 'number' | 'object' | 'string'
>;

export type InstanceOfAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly actual: unknown;
    readonly check: 'instance-of';
    readonly expected: InstanceConstructor;
    readonly message: string | null;
    readonly source: Source;
};

export type HasPropertyAssertionNode<Source extends AssertionSource = AssertionSource> = {
    readonly actual: unknown;
    readonly check: 'has-property';
    readonly key: PropertyKey;
    readonly message: string | null;
    readonly source: Source;
};

export const typeShapeSummaryByCheck = {
    array: 'Expected value to be an array.',
    boolean: 'Expected value to be a boolean.',
    function: 'Expected value to be a function.',
    'has-property': 'Expected object to have the own property.',
    'instance-of': 'Expected value to be an instance of the constructor.',
    number: 'Expected value to be a number.',
    object: 'Expected value to be an object.',
    string: 'Expected value to be a string.'
} as const;

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isSupportedObject(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    return typeof value === 'object' && value !== null;
}

export function evaluateArray(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<TypeAssertionNode>(assertion, 'array')
        ? assertionOutcome(assertion.actual, 'array', Array.isArray(assertion.actual))
        : null;
}

export function evaluateBoolean(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<TypeAssertionNode>(assertion, 'boolean')
        ? assertionOutcome(assertion.actual, 'boolean', typeof assertion.actual === 'boolean')
        : null;
}

export function evaluateFunction(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<TypeAssertionNode>(assertion, 'function')
        ? assertionOutcome(assertion.actual, 'function', typeof assertion.actual === 'function')
        : null;
}

export function evaluateHasProperty(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<HasPropertyAssertionNode>(assertion, 'has-property')
        ? assertionOutcome(
            assertion.actual,
            `own property ${String(assertion.key)}`,
            isSupportedObject(assertion.actual) && Object.hasOwn(assertion.actual, assertion.key)
        )
        : null;
}

export function evaluateInstanceOf(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<InstanceOfAssertionNode>(assertion, 'instance-of')
        ? assertionOutcome(assertion.actual, assertion.expected, assertion.actual instanceof assertion.expected)
        : null;
}

export function evaluateNumber(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<TypeAssertionNode>(assertion, 'number')
        ? assertionOutcome(assertion.actual, 'finite number', isFiniteNumber(assertion.actual))
        : null;
}

export function evaluateObject(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<TypeAssertionNode>(assertion, 'object')
        ? assertionOutcome(assertion.actual, 'plain object', isPlainObject(assertion.actual))
        : null;
}

export function evaluateString(assertion: AssertionCandidate): AssertionOutcome | null {
    return hasAssertionCheck<TypeAssertionNode>(assertion, 'string')
        ? assertionOutcome(assertion.actual, 'string', typeof assertion.actual === 'string')
        : null;
}

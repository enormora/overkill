import { assertionOutcome, type AssertionOutcome } from '../assertion-evaluation.ts';
import type { ActualAssertionNode, AssertionSource, InstanceConstructor } from '../assertion-node-shape.ts';
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

export function evaluateArray(assertion: TypeAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, 'array', Array.isArray(assertion.actual));
}

export function evaluateBoolean(assertion: TypeAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, 'boolean', typeof assertion.actual === 'boolean');
}

export function evaluateFunction(assertion: TypeAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, 'function', typeof assertion.actual === 'function');
}

export function evaluateHasProperty(assertion: HasPropertyAssertionNode): AssertionOutcome {
    return assertionOutcome(
        assertion.actual,
        `own property ${String(assertion.key)}`,
        isSupportedObject(assertion.actual) && Object.hasOwn(assertion.actual, assertion.key)
    );
}

export function evaluateInstanceOf(assertion: InstanceOfAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, assertion.expected, assertion.actual instanceof assertion.expected);
}

export function evaluateNumber(assertion: TypeAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, 'finite number', isFiniteNumber(assertion.actual));
}

export function evaluateObject(assertion: TypeAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, 'plain object', isPlainObject(assertion.actual));
}

export function evaluateString(assertion: TypeAssertionNode): AssertionOutcome {
    return assertionOutcome(assertion.actual, 'string', typeof assertion.actual === 'string');
}

import { serializeValue } from '../compare/serialized-value.ts';
import type { AssertionOutcome } from './assertion-evaluation.ts';
import {
    assertionSummary,
    type AssertionNode,
    type BuiltInAssertAssertionNode,
    type CompositeAssertionChildNode,
    type CompositeAssertionNode,
    type ForeignAssertionNode
} from './assertion-node.ts';
import type { AssertionSource, FailedCheck, NonEmptyReadonlyArray } from './assertion-node-shape.ts';
import { assertionEvaluatorByCheck, type AssertionNodeByCheck } from './assertions/dispatch.ts';
import { resolveSourceLocation } from './source-location.ts';

type DeepAssertionCheckByName = {
    readonly arrayContainsPartial: 'array-contains-partial';
    readonly deepEqual: 'deep-equal';
    readonly membersPartialDeepEqual: 'members-partial-deep-equal';
    readonly notDeepEqual: 'not-deep-equal';
    readonly partialDeepEqual: 'partial-deep-equal';
};

type DeepAssertionCheck = DeepAssertionCheckByName[keyof DeepAssertionCheckByName];

type DeepAssertionOperandRole = 'actual' | 'expected';

type PrimitiveValueTypeByName = {
    readonly bigint: 'bigint';
    readonly boolean: 'boolean';
    readonly null: 'null';
    readonly number: 'number';
    readonly string: 'string';
    readonly symbol: 'symbol';
    readonly undefined: 'undefined';
};

type PrimitiveValueType = PrimitiveValueTypeByName[keyof PrimitiveValueTypeByName];

export type InvalidDeepAssertionOperand = {
    readonly check: DeepAssertionCheck;
    readonly index: number | null;
    readonly role: DeepAssertionOperandRole;
    readonly type: PrimitiveValueType;
};

type AssertionEvaluation = AssertionOutcome & {
    readonly summary: string;
};

type DeepAssertionNode = Extract<AssertionNode | CompositeAssertionChildNode, { readonly check: DeepAssertionCheck; }>;

type DeepOperandFinder = (
    check: DeepAssertionCheck,
    assertion: DeepAssertionNode
) => InvalidDeepAssertionOperand | null;

function primitiveValueType(value: unknown): PrimitiveValueType | null {
    if (value === null) {
        return 'null';
    }

    const valueType = typeof value;

    return valueType === 'object' || valueType === 'function' ? null : valueType;
}

function invalidOperand(
    check: DeepAssertionCheck,
    role: DeepAssertionOperandRole,
    value: unknown,
    index: number | null
): InvalidDeepAssertionOperand | null {
    const type = primitiveValueType(value);

    return type === null
        ? null
        : {
            check,
            index,
            role,
            type
        };
}

function invalidMember(
    check: DeepAssertionCheck,
    role: DeepAssertionOperandRole,
    values: readonly unknown[]
): InvalidDeepAssertionOperand | null {
    for (const [ index, value ] of values.entries()) {
        const invalid = invalidOperand(check, role, value, index);

        if (invalid !== null) {
            return invalid;
        }
    }

    return null;
}

function invalidExactDeepAssertionOperand(
    check: DeepAssertionCheck,
    assertion: DeepAssertionNode
): InvalidDeepAssertionOperand | null {
    return invalidOperand(check, 'actual', assertion.actual, null) ??
        invalidOperand(check, 'expected', assertion.expected, null);
}

function invalidArrayContainsPartialOperand(
    check: DeepAssertionCheck,
    assertion: DeepAssertionNode
): InvalidDeepAssertionOperand | null {
    const invalidActualMember = Array.isArray(assertion.actual)
        ? invalidMember(check, 'actual', assertion.actual)
        : null;

    return invalidOperand(check, 'actual', assertion.actual, null) ??
        invalidActualMember ??
        invalidOperand(check, 'expected', assertion.expected, null);
}

function invalidMembersPartialDeepEqualOperand(
    check: DeepAssertionCheck,
    assertion: DeepAssertionNode
): InvalidDeepAssertionOperand | null {
    const invalidActualMember = Array.isArray(assertion.actual)
        ? invalidMember(check, 'actual', assertion.actual)
        : null;
    const invalidExpectedMember = Array.isArray(assertion.expected)
        ? invalidMember(check, 'expected', assertion.expected)
        : null;

    return invalidOperand(check, 'actual', assertion.actual, null) ??
        invalidOperand(check, 'expected', assertion.expected, null) ??
        invalidActualMember ??
        invalidExpectedMember;
}

const deepOperandFinders: Readonly<Record<DeepAssertionCheck, DeepOperandFinder>> = {
    'array-contains-partial': invalidArrayContainsPartialOperand,
    'deep-equal': invalidExactDeepAssertionOperand,
    'members-partial-deep-equal': invalidMembersPartialDeepEqualOperand,
    'not-deep-equal': invalidExactDeepAssertionOperand,
    'partial-deep-equal': invalidExactDeepAssertionOperand
};

function isDeepAssertionCheck(check: string): check is DeepAssertionCheck {
    return Object.hasOwn(deepOperandFinders, check);
}

function isDeepAssertion(
    assertion: AssertionNode | CompositeAssertionChildNode
): assertion is DeepAssertionNode {
    return isDeepAssertionCheck(assertion.check) && Object.hasOwn(assertion, 'expected');
}

export function invalidDeepAssertionOperand(
    assertion: AssertionNode | CompositeAssertionChildNode
): InvalidDeepAssertionOperand | null {
    if (assertion.check === 'composite') {
        for (const child of assertion.children) {
            const invalid = invalidDeepAssertionOperand(child);

            if (invalid !== null) {
                return invalid;
            }
        }

        return null;
    }

    return isDeepAssertion(assertion)
        ? deepOperandFinders[assertion.check](assertion.check, assertion)
        : null;
}

function evaluateAssertionNode<Check extends keyof AssertionNodeByCheck>(
    check: Check,
    assertion: AssertionNodeByCheck[Check]
): AssertionOutcome {
    return assertionEvaluatorByCheck[check](assertion);
}

function assertNonEmptyItems<Item>(
    items: readonly Item[],
    message: string
): asserts items is NonEmptyReadonlyArray<Item> {
    if (items.length === 0) {
        throw new TypeError(message);
    }
}

function evaluateForeignAssertion(assertion: ForeignAssertionNode, id: string): FailedCheck | null {
    if (assertion.result.passed) {
        return null;
    }

    return {
        actual: serializeValue(assertion.label),
        diff: null,
        error: assertion.result.error,
        expected: serializeValue('foreign assertion pass'),
        id,
        kind: 'foreign',
        label: assertion.label,
        location: resolveSourceLocation(assertion.location),
        path: [],
        source: assertion.source,
        summary: assertion.message ?? assertion.summary
    };
}

function evaluateLeafAssertion(
    assertion: BuiltInAssertAssertionNode<AssertionSource>,
    id: string
): FailedCheck | null {
    const evaluation: AssertionEvaluation = {
        ...evaluateAssertionNode(assertion.check, assertion),
        summary: assertionSummary(assertion)
    };

    if (evaluation.passed) {
        return null;
    }

    return {
        actual: evaluation.actual,
        diff: evaluation.diff,
        expected: evaluation.expected,
        id,
        kind: 'leaf',
        location: resolveSourceLocation(assertion.location),
        path: evaluation.path,
        source: assertion.source,
        summary: evaluation.summary
    };
}

function evaluateCompositeChild(
    assertion: CompositeAssertionChildNode,
    id: string
): FailedCheck | null {
    if (assertion.check === 'foreign') {
        return evaluateForeignAssertion(assertion, id);
    }

    return evaluateLeafAssertion(assertion, id);
}

function evaluateCompositeAssertion(assertion: CompositeAssertionNode, id: string): FailedCheck | null {
    const children = assertion.children.flatMap(function evaluateChild(child, index) {
        const failedCheck = evaluateCompositeChild(child, `${id}.${index + 1}`);

        return failedCheck === null ? [] : [ failedCheck ];
    });

    if (children.length === 0) {
        return null;
    }

    assertNonEmptyItems(children, 'Expected composite assertion failure to contain failed children.');

    return {
        actual: serializeValue(assertion.actual),
        children,
        diff: null,
        expected: serializeValue(assertion.expected),
        id,
        kind: 'composite',
        location: resolveSourceLocation(assertion.location),
        path: [],
        source: assertion.source,
        summary: assertionSummary(assertion)
    };
}

export function evaluateAssertion(
    assertion: AssertionNode | CompositeAssertionChildNode,
    id: number | string
): FailedCheck | null {
    const checkId = String(id);

    if (assertion.check === 'composite') {
        return evaluateCompositeAssertion(assertion, checkId);
    }

    if (assertion.check === 'foreign') {
        return evaluateForeignAssertion(assertion, checkId);
    }

    return evaluateLeafAssertion(assertion, checkId);
}

export function assertionPasses(assertion: AssertionNode): boolean {
    return evaluateAssertion(assertion, 1) === null;
}

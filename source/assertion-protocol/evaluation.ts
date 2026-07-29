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

type AssertionEvaluation = AssertionOutcome & {
    readonly summary: string;
};

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
        error: assertion.result.error,
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
        expected: evaluation.expected,
        id,
        kind: 'leaf',
        location: resolveSourceLocation(assertion.location),
        path: [],
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
        actual: assertion.actual,
        children,
        expected: assertion.expected,
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

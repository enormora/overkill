import type { AssertionOutcome } from './assertion-evaluation.ts';
import { assertionSummary, type AssertionNode } from './assertion-node.ts';
import type { FailedCheck } from './assertion-node-shape.ts';
import { assertionEvaluatorByCheck, type AssertionNodeByCheck } from './assertions/dispatch.ts';

type AssertionEvaluation = AssertionOutcome & {
    readonly summary: string;
};

function evaluateAssertionNode<Check extends keyof AssertionNodeByCheck>(
    check: Check,
    assertion: AssertionNodeByCheck[Check]
): AssertionOutcome {
    return assertionEvaluatorByCheck[check](assertion);
}

function evaluate(assertion: AssertionNode): AssertionEvaluation {
    return {
        ...evaluateAssertionNode(assertion.check, assertion),
        summary: assertionSummary(assertion)
    };
}

export function evaluateAssertion(assertion: AssertionNode, id: number): FailedCheck | null {
    const evaluation = evaluate(assertion);

    if (evaluation.passed) {
        return null;
    }

    return {
        actual: evaluation.actual,
        expected: evaluation.expected,
        id: String(id),
        location: { column: null, file: '', line: null },
        path: [],
        source: assertion.source,
        summary: evaluation.summary
    };
}

export function assertionPasses(assertion: AssertionNode): boolean {
    return evaluateAssertion(assertion, 1) === null;
}

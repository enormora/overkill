import type { AssertionOutcome } from './assertion-evaluation.ts';
import { assertionSummary, type AssertionNode } from './assertion-node.ts';
import type { FailedCheck } from './assertion-node-shape.ts';
import { assertionEvaluators } from './assertions/dispatch.ts';

type AssertionEvaluation = AssertionOutcome & {
    readonly summary: string;
};

function evaluate(assertion: AssertionNode): AssertionEvaluation | null {
    for (const evaluateAssertionNode of assertionEvaluators) {
        const outcome = evaluateAssertionNode(assertion);

        if (outcome !== null) {
            return {
                ...outcome,
                summary: assertionSummary(assertion)
            };
        }
    }

    return null;
}

export function evaluateAssertion(assertion: AssertionNode, id: number): FailedCheck | null {
    const evaluation = evaluate(assertion);

    if (evaluation === null || evaluation.passed) {
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

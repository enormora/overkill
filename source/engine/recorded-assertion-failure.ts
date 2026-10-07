import { evaluateAssertion, invalidDeepAssertionOperand } from '../assertion-protocol/evaluation.ts';
import type { AssertionNode } from '../assertion-protocol/assertion-node.ts';
import { assertNonEmptyItems } from './assertion-recorder.ts';
import { invalidDeepAssertionOperandFailure, type TestFailure, type TestContractFailure } from './run-result.ts';

function evaluatedAssertionFailure(assertions: readonly AssertionNode[]): TestFailure | null {
    const checks = assertions.flatMap(function evaluateRecordedAssertion(assertion, index) {
        const failedCheck = evaluateAssertion(assertion, index + 1);

        return failedCheck === null ? [] : [ failedCheck ];
    });

    if (checks.length === 0) {
        return null;
    }

    assertNonEmptyItems(checks, 'Expected failed checks to be non-empty.');

    return {
        checks,
        kind: 'assertion'
    };
}

function assertionContractFailure(assertions: readonly AssertionNode[]): TestContractFailure | null {
    for (const assertion of assertions) {
        const invalid = invalidDeepAssertionOperand(assertion);

        if (invalid !== null) {
            return invalidDeepAssertionOperandFailure(invalid);
        }
    }

    return null;
}

export function assertionFailure(assertions: readonly AssertionNode[]): TestFailure | null {
    return assertionContractFailure(assertions) ?? evaluatedAssertionFailure(assertions);
}

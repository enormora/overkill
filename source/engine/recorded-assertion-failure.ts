import { InvalidAssertionProtocolError } from '../assertion-protocol/assertion-validation.ts';
import {
    evaluateRecordedAssertion,
    recordedInvalidDeepAssertionOperand,
    type InvalidDeepAssertionOperand
} from '../assertion-protocol/evaluation.ts';
import type { AssertionNode } from '../assertion-protocol/assertion-node.ts';
import { assertionProtocolFailure } from './assertion-protocol-failure.ts';
import { assertNonEmptyItems } from './assertion-recorder.ts';
import type { TestFailure, TestContractFailure } from './run-result.ts';

function invalidDeepAssertionOperandFailure(actual: InvalidDeepAssertionOperand): TestContractFailure {
    return {
        actual,
        code: 'invalid-deep-assertion-operand',
        expected: 'non-primitive deep assertion operand',
        kind: 'test-contract',
        summary: 'Deep assertions require non-primitive operands.'
    };
}

function evaluatedAssertionFailure(assertions: readonly AssertionNode[]): TestFailure | null {
    const checks = assertions.flatMap(function failedCheckAtIndex(assertion, index) {
        const failedCheck = evaluateRecordedAssertion(assertion, index + 1);

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
        const invalid = recordedInvalidDeepAssertionOperand(assertion);

        if (invalid !== null) {
            return invalidDeepAssertionOperandFailure(invalid);
        }
    }

    return null;
}

export function assertionFailure(assertions: readonly AssertionNode[]): TestFailure | null {
    const contract = assertionContractFailure(assertions);
    if (contract !== null) {
        return contract;
    }
    try {
        return evaluatedAssertionFailure(assertions);
    } catch (error) {
        if (!(error instanceof InvalidAssertionProtocolError)) {
            throw error;
        }
        return assertionProtocolFailure(error);
    }
}

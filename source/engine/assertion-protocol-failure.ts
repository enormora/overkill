import type { InvalidAssertionProtocolError } from '../assertion-protocol/assertion-validation.ts';
import type { TestContractFailure } from './run-result.ts';

export function assertionProtocolFailure(error: InvalidAssertionProtocolError): TestContractFailure {
    return {
        actual: error.diagnostic(),
        code: 'invalid-assertion-protocol',
        expected: 'valid assertion protocol data',
        kind: 'test-contract',
        summary: error.message
    };
}

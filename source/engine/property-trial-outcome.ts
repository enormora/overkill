import { assertionPasses, propertyAssertionBoundary } from '../assertion-protocol/evaluation.ts';
import { assertionFailure } from './recorded-assertion-failure.ts';
import type { ExecutedBody } from './body-result.ts';
import type { RunnerError, TestContractFailure, TestFailure } from './run-result.ts';
import type { PropertyTrialResult } from './property-execution-host.ts';

function hasNativeFailure(result: ExecutedBody): boolean {
    return [
        result.cleanupErrors.length > 0,
        result.contractFailures.length > 0,
        result.runnerErrors.length > 0,
        result.inconclusiveReason !== null
    ]
        .includes(true);
}

function hasAdditionalFailures(result: ExecutedBody, failure: TestFailure | null): boolean {
    if (failure?.kind !== 'assertion') {
        return false;
    }
    return result.bodyError !== null || failure.checks.length > 1 ||
        failure.checks.some(function multipleChildren(check) {
            return check.kind === 'composite' && check.children.length > 1;
        });
}

function classifyPropertyTrial(result: ExecutedBody): PropertyTrialResult {
    if (
        hasNativeFailure(result)
    ) {
        return { kind: 'terminated', result };
    }
    const contract = assertionFailure(result.returnedAssertions);
    if (contract?.kind === 'test-contract') {
        return {
            kind: 'terminated',
            result: { ...result, contractFailures: [ ...result.contractFailures, contract ] }
        };
    }
    const primary = result.returnedAssertions.find(function failedAssertion(assertion) {
        return !assertionPasses(assertion);
    });
    if (primary !== undefined) {
        return {
            kind: 'assertion-failed',
            assertion: propertyAssertionBoundary(primary),
            result,
            hasAdditionalFailures: hasAdditionalFailures(result, contract)
        };
    }
    return result.bodyError === null ? { kind: 'passed' } : { kind: 'body-error', result };
}

export function classifyPropertyTrialWithAssertionCount(
    result: ExecutedBody,
    validateAssertionCount: (count: number) => TestContractFailure | null
): PropertyTrialResult {
    const countFailure = validateAssertionCount(result.returnedAssertions.length);
    const unsuccessful = [
        result.contractFailures.length > 0,
        result.inconclusiveReason !== null,
        result.bodyError !== null,
        result.requireFailed
    ]
        .includes(true);
    return classifyPropertyTrial(
        countFailure === null || unsuccessful
            ? result
            : { ...result, contractFailures: [ ...result.contractFailures, countFailure ] }
    );
}

export function propertyTrialWithPolicyErrors(
    trial: PropertyTrialResult,
    errors: readonly RunnerError[]
): PropertyTrialResult {
    if (errors.length === 0) {
        return trial;
    }
    const result: ExecutedBody = trial.kind === 'passed'
        ? {
            bodyError: null,
            cleanupErrors: [],
            contractFailures: [],
            inconclusiveReason: null,
            requireFailed: false,
            runnerErrors: [],
            returnedAssertions: []
        }
        : trial.result;
    return { kind: 'terminated', result: { ...result, runnerErrors: [ ...result.runnerErrors, ...errors ] } };
}

import { assertionPasses, evaluateAssertion } from '../assertion-protocol/evaluation.ts';
import type { AssertAssertionNode, AssertionNode } from '../assertion-protocol/assertion-node.ts';
import { assertionFailure } from './recorded-assertion-failure.ts';
import type { ExecutedBody } from './body-result.ts';
import type { RunnerError } from './run-result.ts';
import type { PropertyTrialResult } from './property-execution-host.ts';

function propertyBoundary(assertion: AssertionNode): AssertAssertionNode {
    if (assertion.check !== 'composite') {
        return { ...assertion, source: 'assert' };
    }
    const primary = assertion.children.find(function failedChild(child) {
        return evaluateAssertion(child, 1) !== null;
    });
    if (primary === undefined) {
        throw new Error('Failed property composite requires a failed child.');
    }
    return { ...assertion, source: 'assert', children: [ { ...primary, source: 'assert' } ] };
}

function hasNativeFailure(result: ExecutedBody): boolean {
    return [
        result.bodyError !== null,
        result.cleanupErrors.length > 0,
        result.contractFailures.length > 0,
        result.runnerErrors.length > 0,
        result.inconclusiveReason !== null
    ]
        .includes(true);
}

export function classifyPropertyTrial(result: ExecutedBody): PropertyTrialResult {
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
    return primary === undefined
        ? { kind: 'passed' }
        : { kind: 'assertion-failed', assertion: propertyBoundary(primary), result };
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

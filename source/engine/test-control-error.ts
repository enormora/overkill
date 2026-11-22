import type { ThrownAssertionObservation } from '../assertion-protocol/thrown-matcher.ts';
import { isPropertyInconclusiveSignalError } from './property-inconclusive.ts';
import { isRequireFailedSignalError, isTestContractSignalError } from './assertion-control-error.ts';
import { isPropertyTermination } from './property-control-error.ts';
import { isAccessDeniedError, isCaseRunnerError } from './run-result.ts';

function matchesTestControlError(error: unknown): boolean {
    return isPropertyInconclusiveSignalError(error) || isRequireFailedSignalError(error) ||
        isTestContractSignalError(error) ||
        isPropertyTermination(error) || isCaseRunnerError(error) || isAccessDeniedError(error);
}

export function isTestControlError(error: unknown): boolean {
    try {
        return matchesTestControlError(error);
    } catch {
        return false;
    }
}

export function observeThrow(body: () => unknown): ThrownAssertionObservation {
    try {
        return { status: 'returned', value: body() };
    } catch (error: unknown) {
        if (isTestControlError(error)) {
            throw error;
        }
        return { status: 'threw', value: error };
    }
}

export async function observeRejection(promise: PromiseLike<unknown>): Promise<ThrownAssertionObservation> {
    try {
        return { status: 'resolved', value: await promise };
    } catch (error: unknown) {
        return { status: 'rejected', value: error };
    }
}

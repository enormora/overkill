import { isPropertyInconclusiveSignalError } from './property-inconclusive.ts';
import { isRequireFailedSignalError, isTestContractSignalError } from './assertion-recorder.ts';
import { isPropertyTermination } from './property-execution-host.ts';
import { isAccessDeniedError, isCaseRunnerError } from './run-result.ts';

export function isTestControlError(error: unknown): boolean {
    return isPropertyInconclusiveSignalError(error) || isRequireFailedSignalError(error) ||
        isTestContractSignalError(error) ||
        isPropertyTermination(error) || isCaseRunnerError(error) || isAccessDeniedError(error);
}

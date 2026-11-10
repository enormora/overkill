import { isPropertyInconclusiveSignalError } from './property-inconclusive.ts';
import { RequireFailedSignalError, TestContractSignalError } from './assertion-recorder.ts';
import { isPropertyTermination } from './property-execution-host.ts';
import { isAccessDeniedError, isCaseRunnerError } from './run-result.ts';

export function isTestControlError(error: unknown): boolean {
    return isPropertyInconclusiveSignalError(error) || error instanceof RequireFailedSignalError ||
        error instanceof TestContractSignalError ||
        isPropertyTermination(error) || isCaseRunnerError(error) || isAccessDeniedError(error);
}

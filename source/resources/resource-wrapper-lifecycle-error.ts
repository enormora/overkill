import { CaseRunnerError } from '../engine/run-result.ts';
import { ResourceLifecycleError } from './resource-lifecycle-error.ts';

export function resourceWrapperLifecycleError(message: string, cause: unknown): CaseRunnerError {
    const runnerCause = cause instanceof ResourceLifecycleError && cause.cause !== undefined
        ? cause.cause
        : cause;

    return new CaseRunnerError(message, {
        cause: runnerCause,
        subtype: 'fixture'
    });
}

export function resourceWrapperErrorFromUnknown(message: string, cause: unknown): CaseRunnerError {
    return cause instanceof CaseRunnerError
        ? cause
        : resourceWrapperLifecycleError(message, cause);
}

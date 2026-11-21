import { CaseRunnerError } from '../engine/run-result.ts';
import { ResourceLifecycleError } from '../resources/resource-lifecycle-error.ts';
import { currentReplayWitness } from './replay-context.ts';

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

export function resourceReplayErrorMessage(message: string, cause: unknown): string {
    return `${message}: ${cause instanceof Error ? cause.message : String(cause)}`;
}

export function managedResourceErrorMessage(message: string, cause: unknown): string {
    return currentReplayWitness()?.kind === 'simulation'
        ? resourceReplayErrorMessage(message, cause)
        : `${message}.`;
}

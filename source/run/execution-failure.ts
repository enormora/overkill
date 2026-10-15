import { ConfigError } from '../config/config-error.ts';
import { RunCollectionError, RunResolutionError } from './run-errors.ts';
import type { RunExecutionFailure } from './execution-failure-schema.ts';

type CollectionFailure = Extract<RunExecutionFailure, { readonly kind: 'collection-error'; }>;

class RunExecutionCollectionError extends RunCollectionError {
    private readonly failure: CollectionFailure;

    public constructor(failure: CollectionFailure, options: Readonly<ErrorOptions>) {
        super(failure.message, options, failure.errors[0].subtype);
        this.name = 'RunExecutionCollectionError';
        this.failure = failure;
    }

    public override runnerError(): CollectionFailure['errors'][number] {
        return this.failure.errors[0];
    }

    public override runnerErrors(): CollectionFailure['errors'] {
        return this.failure.errors;
    }
}

function failureDetails(error: unknown): Pick<RunExecutionFailure, 'cause' | 'message' | 'name' | 'stack'> {
    return {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
        cause: error instanceof Error ? error.cause : error,
        stack: error instanceof Error ? error.stack ?? null : null
    };
}

export function runExecutionFailure(error: unknown): RunExecutionFailure {
    const fields = failureDetails(error);
    if (error instanceof ConfigError) {
        return { ...fields, kind: 'config-error' };
    }
    if (error instanceof RunResolutionError) {
        return { ...fields, kind: 'resolution-error', code: error.code() };
    }
    if (error instanceof RunCollectionError) {
        const [ first, ...remaining ] = error.runnerErrors();
        if (first !== undefined) {
            return { ...fields, kind: 'collection-error', errors: [ first, ...remaining ] };
        }
    }
    return {
        ...fields,
        kind: 'error',
        cause: error instanceof AggregateError ? { cause: error.cause, errors: error.errors } : fields.cause
    };
}

function restoredInvocationError(failure: RunExecutionFailure): Error {
    if (failure.kind === 'config-error') {
        return new ConfigError(failure.message, { cause: failure.cause });
    }
    if (failure.kind === 'resolution-error') {
        return new RunResolutionError(failure.message, { cause: failure.cause }, failure.code);
    }
    if (failure.kind === 'collection-error') {
        return new RunExecutionCollectionError(failure, { cause: failure.cause });
    }
    const unexpected: Extract<RunExecutionFailure, { readonly kind: 'error'; }> = failure;
    return new Error(unexpected.message, { cause: unexpected.cause });
}

export function restoreRunExecutionFailure(failure: RunExecutionFailure): Error {
    const error = restoredInvocationError(failure);
    error.name = failure.name;
    if (failure.stack !== null) {
        error.stack = failure.stack;
    }
    return error;
}

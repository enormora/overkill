import { ConfigError, RunCollectionError, RunResolutionError } from '../run/run.entry-point.ts';
import type { MutationInvocationFailure } from './mutation-invocation-protocol.ts';

type CollectionFailure = Extract<MutationInvocationFailure, { readonly kind: 'collection-error'; }>;

class MutationInvocationCollectionError extends RunCollectionError {
    private readonly failure: CollectionFailure;

    public constructor(failure: CollectionFailure, options: Readonly<ErrorOptions>) {
        super(failure.message, options, failure.errors[0].subtype);
        this.name = 'MutationInvocationCollectionError';
        this.failure = failure;
    }

    public override runnerError(): CollectionFailure['errors'][number] {
        return this.failure.errors[0];
    }

    public override runnerErrors(): CollectionFailure['errors'] {
        return this.failure.errors;
    }
}

function failureDetails(error: unknown): Pick<MutationInvocationFailure, 'cause' | 'message' | 'stack'> {
    return {
        message: error instanceof Error ? error.message : String(error),
        cause: error instanceof Error ? error.cause : error,
        stack: error instanceof Error ? error.stack ?? null : null
    };
}

export function mutationInvocationFailure(error: unknown): MutationInvocationFailure {
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

function restoredInvocationError(failure: MutationInvocationFailure): Error {
    if (failure.kind === 'config-error') {
        return new ConfigError(failure.message, { cause: failure.cause });
    }
    if (failure.kind === 'resolution-error') {
        return new RunResolutionError(failure.message, { cause: failure.cause }, failure.code);
    }
    if (failure.kind === 'collection-error') {
        return new MutationInvocationCollectionError(failure, { cause: failure.cause });
    }
    const unexpected: Extract<MutationInvocationFailure, { readonly kind: 'error'; }> = failure;
    return new Error(unexpected.message, { cause: unexpected.cause });
}

export function restoreMutationInvocationFailure(failure: MutationInvocationFailure): Error {
    const error = restoredInvocationError(failure);
    if (failure.stack !== null) {
        error.stack = failure.stack;
    }
    return error;
}
